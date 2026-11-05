import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from './config.ts';
import { Refusal } from './refusal.ts';

export interface BackupItem {
  path: string;
  kind: 'postgres' | 'volume';
  bytes: number;
  service?: string;
  volume?: string;
  sqlite?: string[];
}

export interface BackupSummary {
  project: string;
  stamp: string;
  started: string;
  finished?: string;
  archive?: string;
  bytes?: number;
  imported?: boolean;
  ok: boolean;
  errors: string[];
  items: BackupItem[];
}

export interface BackupRequest {
  id: string;
  action: 'run' | 'verify' | 'restore';
  project: string;
  archive?: string;
  by: string;
  state: 'waiting' | 'running' | 'done' | 'failed';
  output?: string;
  at?: string;
}

export interface Schedule {
  enabled: boolean;
  everyHours: number;
  hour: number;
  keepDays: number;
}

export const defaultSchedule: Schedule = { enabled: true, everyHours: 24, hour: 3, keepDays: 14 };
export const periods = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168];

export function nextRun(schedule: Schedule, now: number) {
  const period = schedule.everyHours * 3600_000;
  const anchor = schedule.hour * 3600_000;
  return anchor + Math.ceil((now - anchor) / period) * period;
}

export async function readSchedule(root = backupRoot()): Promise<Schedule> {
  return { ...defaultSchedule, ...(await json<Partial<Schedule>>(path.join(root, '.schedule.json')).catch(missing)) };
}

export async function writeSchedule(input: unknown, login: string, root = backupRoot()) {
  const { enabled, everyHours, hour, keepDays } = (input ?? {}) as Record<string, unknown>;
  const whole = (value: unknown, least: number, most: number) => Number.isInteger(value) && (value as number) >= least && (value as number) <= most;
  if (typeof enabled !== 'boolean' || !periods.includes(everyHours as number) || !whole(hour, 0, 23) || !whole(keepDays, 1, 90)) {
    throw new Refusal(400, `A schedule is on or off, every ${periods.join(', ')} hours, at an hour from 0 to 23, kept 1 to 90 days.`);
  }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, '.schedule.json.partial'), JSON.stringify({ enabled, everyHours, hour, keepDays }));
  await rename(path.join(root, '.schedule.json.partial'), path.join(root, '.schedule.json'));
  await audit(login, 'schedule', '*', `${enabled ? `every ${everyHours} h from ${hour}:00 UTC` : 'off'}, ${keepDays} days`, root);
}

function missing(error: NodeJS.ErrnoException) {
  if (error.code === 'ENOENT') {
    return undefined;
  }
  throw error;
}

export const projectPattern = /^[a-z0-9][a-z0-9_-]*$/;
export const stampPattern = /^\d{8}T\d{6}Z$/;
const hour = 3600_000;
const states: Record<string, BackupRequest['state']> = { request: 'waiting', running: 'running', result: 'done' };

export function backupRoot(root = config.hostRoot) {
  return path.join(root, 'var/lib/graphite/backups');
}

async function json<T>(file: string) {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

function folders(root: string) {
  return readdir(root, { withFileTypes: true }).then(
    (entries) => entries.filter((entry) => entry.isDirectory() && projectPattern.test(entry.name)).map((entry) => entry.name),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    },
  );
}

export async function listBackups(root = backupRoot()) {
  return Promise.all(
    (await folders(root)).sort().map(async (project) => {
      const files = (await readdir(path.join(root, project))).filter((name) => stampPattern.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
      const archives = await Promise.all(files.map((name) => json<BackupSummary>(path.join(root, project, name))));
      return { project, archives: archives.sort((a, b) => b.stamp.localeCompare(a.stamp)) };
    }),
  );
}

export function stampTime(stamp: string) {
  return Date.parse(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);
}

export async function backupConditions(now: number, root = backupRoot(), least = 26) {
  const schedule = await readSchedule(root);
  if (!schedule.enabled) {
    return [];
  }
  const hours = Math.max(least, schedule.everyHours + 2);
  return (await listBackups(root)).flatMap(({ project, archives }) => {
    const latest = archives.find((archive) => !archive.imported);
    if (!latest) {
      return [];
    }
    if (now - stampTime(latest.stamp) > hours * hour) {
      return [{ key: `backup:${project}`, title: `${project} has no recent backup`, detail: `The newest backup is ${Math.round((now - stampTime(latest.stamp)) / hour)} hours old.` }];
    }
    if (!latest.ok) {
      return [{ key: `backup:${project}`, title: `${project}'s last backup failed`, detail: latest.errors.join('; ') }];
    }
    return [];
  });
}

export async function requests(root = backupRoot()) {
  const folder = path.join(root, '.requests');
  const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [] as string[];
    }
    throw error;
  });
  const found = await Promise.all(
    names.map(async (name) => {
      const [id, suffix] = name.split('.');
      const state = states[suffix];
      if (!state) {
        return undefined;
      }
      const order = await json<Omit<BackupRequest, 'id' | 'state'> & { ok?: boolean }>(path.join(folder, name));
      return { ...order, id, state: state === 'done' && order.ok === false ? 'failed' : state } as BackupRequest;
    }),
  );
  return found.filter((entry) => entry !== undefined).sort((a, b) => (b.at ?? '￿').localeCompare(a.at ?? '￿')).slice(0, 20);
}

export async function audit(login: string, action: string, project: string, archive?: string, root = backupRoot()) {
  await mkdir(root, { recursive: true });
  await appendFile(path.join(root, 'audit.log'), `${JSON.stringify({ at: new Date().toISOString(), login, action, project, archive })}\n`);
}

export async function order(action: BackupRequest['action'], project: string, by: string, archive?: string, root = backupRoot()) {
  if (!projectPattern.test(project)) {
    throw new Refusal(400, `${project} is not a project name.`);
  }
  if (archive !== undefined) {
    await stat(path.join(root, project, archive)).catch(() => {
      throw new Refusal(404, `There is no ${project}/${archive}.`);
    });
  }
  const id = randomUUID();
  const folder = path.join(root, '.requests');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${id}.partial`), JSON.stringify({ action, project, archive, by }));
  await rename(path.join(folder, `${id}.partial`), path.join(folder, `${id}.request`));
  await audit(by, action, project, archive, root);
  return id;
}

export async function download(response: ServerResponse, project: string, stamp: string, login: string, root = backupRoot()) {
  const file = path.join(root, project, `${stamp}.tar`);
  const size = (
    await stat(file).catch(() => {
      throw new Refusal(404, `There is no ${project}/${stamp}.tar.`);
    })
  ).size;
  await audit(login, 'download', project, `${stamp}.tar`, root);
  response.writeHead(200, {
    'Content-Type': 'application/x-tar',
    'Content-Length': size,
    'Content-Disposition': `attachment; filename="${project}-${stamp}.tar"`,
    'Cache-Control': 'no-store',
  });
  await pipeline(createReadStream(file), response);
}

export async function upload(request: IncomingMessage, project: string, login: string, now = new Date(), root = backupRoot()) {
  if (!projectPattern.test(project)) {
    throw new Refusal(400, `${project} is not a project name.`);
  }
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const folder = path.join(root, project);
  await mkdir(folder, { recursive: true });
  const partial = path.join(folder, `${stamp}.tar.partial`);
  try {
    await pipeline(request, createWriteStream(partial));
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  await rename(partial, path.join(folder, `${stamp}.tar`));
  await audit(login, 'import', project, `${stamp}.tar`, root);
  return { stamp, id: await order('verify', project, login, `${stamp}.tar`, root) };
}
