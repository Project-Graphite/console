import type { WebSocket } from 'ws';
import { config } from './config.ts';
import { Demuxer, docker, stream, upgrade } from './docker.ts';

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

export async function logs(socket: WebSocket, container: string) {
  const { Config } = await docker<{ Config: { Tty: boolean } }>('GET', `/containers/${container}/json`);
  const response = await stream('GET', `/containers/${container}/logs?follow=1&stdout=1&stderr=1&tail=300&timestamps=1`);
  const demuxer = Config.Tty ? undefined : new Demuxer();
  response.on('data', (chunk: Buffer) => {
    for (const frame of demuxer ? demuxer.push(chunk) : [chunk]) {
      socket.send(frame.toString());
    }
  });
  response.on('end', () => socket.close());
  socket.on('close', () => response.destroy());
}
