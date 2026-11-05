import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';
import { Demuxer, docker, stream } from './docker.ts';
import { Refusal } from './refusal.ts';

function applied(project: string, file: string) {
  return path.join(config.hostRoot, config.graphiteHome, project, file);
}

function missingIsEmpty(error: NodeJS.ErrnoException) {
  if (error.code === 'ENOENT') {
    return undefined;
  }
  throw error;
}

export async function appliedCompose(project: string) {
  return (await readFile(applied(project, 'compose.yaml'), 'utf8').catch(missingIsEmpty)) ?? '';
}

export async function appliedValueNames(project: string) {
  const text = (await readFile(applied(project, 'values'), 'utf8').catch(missingIsEmpty)) ?? '';
  return new Set(text.split('\n').flatMap((line) => /^([A-Z_][A-Z0-9_]*)=/.exec(line)?.[1] ?? []));
}

export async function appliedAt(project: string) {
  return (await stat(applied(project, '.applied')).catch(missingIsEmpty))?.mtimeMs ?? null;
}

export async function onHost(command: string[]) {
  const { Id } = await docker<{ Id: string }>('POST', `/containers/${config.self}/exec`, {
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    Cmd: ['nsenter', '--target', '1', '--all', '--', ...command],
  });
  const demuxer = new Demuxer();
  const chunks: Buffer[] = [];
  for await (const chunk of await stream('POST', `/exec/${Id}/start`, { Detach: false, Tty: false })) {
    chunks.push(...demuxer.push(chunk as Buffer).map((frame) => frame.data));
  }
  const { ExitCode } = await docker<{ ExitCode: number }>('GET', `/exec/${Id}/json`);
  return { code: ExitCode, output: Buffer.concat(chunks).toString('utf8').trim() };
}

const unit = (project: string) => `graphite-redeploy-${project}`;

export async function redeployStatus(project: string) {
  const { output } = await onHost(['systemctl', 'show', unit(project), '--property=ActiveState,SubState,InvocationID,StateChangeTimestamp']);
  const properties = Object.fromEntries(output.split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const state =
    properties.ActiveState === 'activating' || properties.SubState === 'running'
      ? 'running'
      : properties.ActiveState === 'failed'
        ? 'failed'
        : properties.SubState === 'exited'
          ? 'done'
          : 'none';
  const log =
    state !== 'none' && properties.InvocationID
      ? (await onHost(['journalctl', `_SYSTEMD_INVOCATION_ID=${properties.InvocationID}`, '--no-pager', '--output=cat', '--lines=30'])).output
      : '';
  return { state, log, at: properties.StateChangeTimestamp || null };
}

export async function startRedeploy(project: string) {
  if ((await stat(applied(project, 'compose.yaml')).catch(missingIsEmpty)) === undefined) {
    throw new Refusal(404, `${project} has not been deployed by the agent.`);
  }
  if ((await redeployStatus(project)).state === 'running') {
    throw new Refusal(409, `${project} is already redeploying.`);
  }
  await onHost(['systemctl', 'reset-failed', unit(project)]);
  await onHost(['systemctl', 'stop', unit(project)]);
  const started = await onHost([
    'systemd-run',
    `--unit=${unit(project)}`,
    `--description=Redeploy ${project} from the console`,
    '--remain-after-exit',
    '--property=RuntimeMaxSec=900',
    path.posix.join(config.graphiteHome, 'bin', 'graphite-up'),
    project,
  ]);
  if (started.code !== 0) {
    throw new Refusal(502, `The host refused to start the redeploy: ${started.output}`);
  }
}
