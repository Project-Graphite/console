import type http from 'node:http';
import type { WebSocket } from 'ws';
import { config } from './config.ts';
import { Demuxer, docker, LogLines, stream, upgrade } from './docker.ts';

const shell = ['/bin/sh', '-c', 'if command -v bash >/dev/null; then exec bash; else exec sh; fi'];
const hostShell = ['nsenter', '--target', '1', '--all', '--', '/bin/bash', '-l'];

export async function terminal(socket: WebSocket, target: 'host' | { container: string }) {
  const container = target === 'host' ? config.self : target.container;
  const { Id: exec } = await docker<{ Id: string }>('POST', `/containers/${container}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Env: ['TERM=xterm-256color'],
    Cmd: target === 'host' ? hostShell : shell,
  });
  const pipe = await upgrade(`/exec/${exec}/start`, { Detach: false, Tty: true });

  pipe.on('data', (chunk: Buffer) => socket.send(chunk));
  pipe.on('close', () => socket.close());
  socket.on('message', (message: Buffer) => {
    const text = message.toString();
    if (text.startsWith('\u0000resize:')) {
      const [cols, rows] = text.slice(8).split('x').map(Number);
      void docker('POST', `/exec/${exec}/resize?h=${rows}&w=${cols}`).catch(() => undefined);
    } else {
      pipe.write(message);
    }
  });
  socket.on('close', () => pipe.destroy());
}

const bufferLimit = 1 << 20;

export function resumeAfter(time: string) {
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(time);
  if (!match) {
    throw new Error('The resume point is not a Docker log timestamp.');
  }
  const seconds = Date.parse(`${match[1]}Z`) / 1000;
  const nanoseconds = Number((match[2] ?? '').padEnd(9, '0')) + 1;
  return nanoseconds === 1e9 ? `${seconds + 1}.000000000` : `${seconds}.${String(nanoseconds).padStart(9, '0')}`;
}

export function logQuery(params: URLSearchParams) {
  const after = params.get('after');
  if (after) {
    return `follow=1&tail=all&since=${resumeAfter(after)}`;
  }
  return `follow=${params.get('follow') === '0' ? 0 : 1}&tail=${Math.min(Math.max(Math.trunc(Number(params.get('tail'))) || 100, 1), 5000)}`;
}

async function readLogs(container: string, query: string) {
  const { Config } = await docker<{ Config: { Tty: boolean } }>('GET', `/containers/${container}/json`);
  const output = await stream('GET', `/containers/${container}/logs?stdout=1&stderr=1&timestamps=1&${query}`);
  const demuxer = Config.Tty ? undefined : new Demuxer();
  const lines = new LogLines();
  return {
    output,
    read: (chunk: Buffer) =>
      demuxer ? demuxer.push(chunk).flatMap((frame) => lines.push(frame.stream === 2 ? 'stderr' : 'stdout', frame.data)) : lines.push('stdout', chunk),
  };
}

export async function logs(socket: WebSocket, container: string, params: URLSearchParams) {
  const { output, read } = await readLogs(container, logQuery(params));
  const heartbeat = setInterval(() => socket.ping(), 30_000);
  output.on('data', (chunk: Buffer) => {
    const batch = read(chunk);
    if (!batch.length) {
      return;
    }
    socket.send(JSON.stringify(batch), () => {
      if (socket.bufferedAmount < bufferLimit) {
        output.resume();
      }
    });
    if (socket.bufferedAmount >= bufferLimit) {
      output.pause();
    }
  });
  output.on('end', () => socket.close());
  socket.on('close', () => {
    clearInterval(heartbeat);
    output.destroy();
  });
}

export async function downloadLogs(response: http.ServerResponse, container: { id: string; name: string }) {
  const { output, read } = await readLogs(container.id, 'tail=all');
  response.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="${container.name}-all-logs.txt"`,
    'Cache-Control': 'no-store',
  });
  output.on('data', (chunk: Buffer) => {
    const batch = read(chunk);
    if (batch.length && !response.write(batch.map((line) => `${line.time} ${line.text}
`).join(''))) {
      output.pause();
      response.once('drain', () => output.resume());
    }
  });
  output.on('end', () => response.end());
  response.on('close', () => output.destroy());
}
