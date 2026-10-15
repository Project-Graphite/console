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

const logTails = [100, 300, 1000, 5000];
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
    return `tail=all&since=${resumeAfter(after)}`;
  }
  const tail = Number(params.get('tail'));
  return `tail=${logTails.includes(tail) ? tail : 300}`;
}

export async function logs(socket: WebSocket, container: string, params: URLSearchParams) {
  const { Config } = await docker<{ Config: { Tty: boolean } }>('GET', `/containers/${container}/json`);
  const response = await stream('GET', `/containers/${container}/logs?follow=1&stdout=1&stderr=1&timestamps=1&${logQuery(params)}`);
  const demuxer = Config.Tty ? undefined : new Demuxer();
  const lines = new LogLines();
  const heartbeat = setInterval(() => socket.ping(), 30_000);
  response.on('data', (chunk: Buffer) => {
    const batch = demuxer
      ? demuxer.push(chunk).flatMap((frame) => lines.push(frame.stream === 2 ? 'stderr' : 'stdout', frame.data))
      : lines.push('stdout', chunk);
    if (!batch.length) {
      return;
    }
    socket.send(JSON.stringify(batch), () => {
      if (socket.bufferedAmount < bufferLimit) {
        response.resume();
      }
    });
    if (socket.bufferedAmount >= bufferLimit) {
      response.pause();
    }
  });
  response.on('end', () => socket.close());
  socket.on('close', () => {
    clearInterval(heartbeat);
    response.destroy();
  });
}
