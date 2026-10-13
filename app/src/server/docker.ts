import http from 'node:http';
import type { Duplex } from 'node:stream';
import { config } from './config.ts';

export interface DockerContainer {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  State: string;
  Status: string;
  Created: number;
  Labels: Record<string, string>;
  Ports: { PrivatePort: number; PublicPort?: number; Type: string }[];
  NetworkSettings: { Networks: Record<string, { IPAddress: string; NetworkID: string }> };
}

export interface DockerStats {
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number };
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number };
  memory_stats: { usage?: number; limit?: number; stats?: { inactive_file?: number } };
}

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return http.request({
    socketPath: config.dockerSocket,
    method,
    path,
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
  });
}

export function stream(method: string, path: string, body?: unknown) {
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = call(method, path, body);
    request.on('response', (response) => {
      if ((response.statusCode ?? 500) >= 400) {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => reject(new Error(`Docker answered ${response.statusCode} for ${path}: ${text.trim()}`)));
        return;
      }
      resolve(response);
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export async function docker<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await stream(method, path, body);
  let text = '';
  for await (const chunk of response) {
    text += chunk;
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export function upgrade(path: string, body: unknown) {
  return new Promise<Duplex>((resolve, reject) => {
    const request = call('POST', path, body, { Connection: 'Upgrade', Upgrade: 'tcp' });
    request.on('upgrade', (_response, socket) => resolve(socket));
    request.on('response', (response) => reject(new Error(`Docker answered ${response.statusCode} for ${path}`)));
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

export function cpuPercent(stats: DockerStats) {
  const cpu = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const system = (stats.cpu_stats.system_cpu_usage ?? 0) - (stats.precpu_stats.system_cpu_usage ?? 0);
  return cpu > 0 && system > 0 ? (cpu / system) * (stats.cpu_stats.online_cpus ?? 1) * 100 : 0;
}

export function memoryUsed(stats: DockerStats) {
  return Math.max(0, (stats.memory_stats.usage ?? 0) - (stats.memory_stats.stats?.inactive_file ?? 0));
}

export class Demuxer {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];
    while (this.buffer.length >= 8) {
      const size = this.buffer.readUInt32BE(4);
      if (this.buffer.length < 8 + size) {
        break;
      }
      frames.push(this.buffer.subarray(8, 8 + size));
      this.buffer = this.buffer.subarray(8 + size);
    }
    return frames;
  }
}
