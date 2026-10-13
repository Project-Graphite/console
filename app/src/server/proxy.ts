import http from 'node:http';
import type { Duplex } from 'node:stream';
import { withoutSession } from './auth.ts';
import { config } from './config.ts';
import { docker } from './docker.ts';

interface Inspected {
  NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
}

async function address(container: string) {
  const [target, self] = await Promise.all([
    docker<Inspected>('GET', `/containers/${container}/json`),
    docker<Inspected>('GET', `/containers/${config.self}/json`),
  ]);
  const networks = Object.keys(target.NetworkSettings.Networks);
  const shared = networks.find((network) => network in self.NetworkSettings.Networks);
  if (!shared) {
    await docker('POST', `/networks/${networks[0]}/connect`, { Container: config.self });
  }
  return target.NetworkSettings.Networks[shared ?? networks[0]].IPAddress;
}

export function parseOpen(pathname: string) {
  const match = /^\/open\/([0-9a-f]{12,64})\/(\d{1,5})(\/.*)?$/.exec(pathname);
  return match ? { container: match[1], port: Number(match[2]), path: match[3] ?? '/' } : undefined;
}

function forwardedHeaders(request: http.IncomingMessage) {
  const headers: http.OutgoingHttpHeaders = { ...request.headers, cookie: withoutSession(request.headers.cookie) };
  delete headers['cf-access-jwt-assertion'];
  return headers;
}

export async function open(request: http.IncomingMessage, response: http.ServerResponse, target: { container: string; port: number; path: string }, search: string) {
  const host = await address(target.container);
  const upstream = http.request(
    { host, port: target.port, method: request.method, path: target.path + search, headers: forwardedHeaders(request) },
    (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on('error', (error) => response.writeHead(502).end(`Could not reach port ${target.port}: ${error.message}`));
  request.pipe(upstream);
}

export async function openSocket(request: http.IncomingMessage, socket: Duplex, head: Buffer, target: { container: string; port: number; path: string }, search: string) {
  const host = await address(target.container);
  const upstream = http.request({ host, port: target.port, path: target.path + search, headers: forwardedHeaders(request) });
  upstream.on('upgrade', (reply, remote, remoteHead) => {
    const lines = Object.entries(reply.headers).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value]).map((item) => `${key}: ${item}`),
    );
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    remote.write(head);
    socket.write(remoteHead);
    remote.pipe(socket).pipe(remote);
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
}
