import type http from 'node:http';
import { cpuPercent, docker, ioTotals, memoryUsed, networkTotals, stream, type DockerStats } from './docker.ts';
import type { History } from './history.ts';
import { diskSpace, readHost } from './host.ts';

export interface Traffic {
  rx: number;
  tx: number;
  read: number;
  write: number;
}

export interface ContainerLive extends Traffic {
  project: string;
  cpu: number;
  cpuLimit: number | null;
  memory: number;
  memoryLimit: number | null;
}

export interface HostLive extends Traffic {
  cpu: number;
  cpus: number;
  load: number[];
  uptime: number;
  memory: { used: number; total: number };
  swap: { used: number; total: number };
  disk: { used: number; total: number };
}

export interface Frame {
  at: number;
  host: HostLive;
  containers: Record<string, ContainerLive>;
}

interface Tracked {
  name: string;
  project: string;
  cpuLimit: number | null;
  response?: http.IncomingMessage;
  last?: Traffic & { at: number };
  value?: ContainerLive;
}

interface Sums {
  seconds: number;
  cpu: number;
  cpuPeak: number;
  memory: number;
  memoryPeak: number;
  net: number;
  io: number;
}

export const windowSeconds = 180;
const tracked = new Map<string, Tracked>();
const frames: Frame[] = [];
const listeners = new Set<(frame: Frame) => void>();
const sums = new Map<string, Sums>();
let minute = 0;
let previousHost: { at: number; idle: number; total: number; traffic: Traffic } | undefined;
let space = { used: 0, total: 0 };
let ready: (frame: Frame) => void;
const first = new Promise<Frame>((resolve) => (ready = resolve));

export function rate(now: number, before: number | undefined, seconds: number) {
  return before === undefined || seconds <= 0 ? 0 : Math.max(0, (now - before) / seconds);
}

function read(entry: Tracked, stats: DockerStats) {
  const at = Date.parse(stats.read ?? '') || Date.now();
  const traffic = { ...networkTotals(stats), ...ioTotals(stats) };
  const seconds = entry.last ? (at - entry.last.at) / 1000 : 0;
  entry.value = {
    project: entry.project,
    cpu: cpuPercent(stats),
    cpuLimit: entry.cpuLimit,
    memory: memoryUsed(stats),
    memoryLimit: stats.memory_stats.limit ?? null,
    rx: rate(traffic.rx, entry.last?.rx, seconds),
    tx: rate(traffic.tx, entry.last?.tx, seconds),
    read: rate(traffic.read, entry.last?.read, seconds),
    write: rate(traffic.write, entry.last?.write, seconds),
  };
  entry.last = { at, ...traffic };
}

async function follow(id: string, name: string, project: string) {
  const entry: Tracked = { name, project, cpuLimit: null };
  tracked.set(id, entry);
  try {
    const { HostConfig } = await docker<{ HostConfig: { NanoCpus: number } }>('GET', `/containers/${id}/json`);
    entry.cpuLimit = HostConfig.NanoCpus ? HostConfig.NanoCpus / 1e9 : null;
    const response = await stream('GET', `/containers/${id}/stats?stream=1`);
    if (tracked.get(id) !== entry) {
      response.destroy();
      return;
    }
    entry.response = response;
    let buffer = '';
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) {
          read(entry, JSON.parse(line) as DockerStats);
        }
      }
    });
    response.on('close', () => {
      if (tracked.get(id) === entry) {
        tracked.delete(id);
      }
    });
  } catch (error) {
    tracked.delete(id);
    console.error(`following ${name} failed:`, error);
  }
}

export function track(views: { id: string; name: string; project: string; state: string }[]) {
  const running = new Map(views.filter((view) => view.state === 'running').map((view) => [view.id, view]));
  for (const [id, entry] of tracked) {
    if (!running.has(id)) {
      entry.response?.destroy();
      tracked.delete(id);
    }
  }
  for (const [id, view] of running) {
    if (!tracked.has(id)) {
      void follow(id, view.name, view.project);
    }
  }
}

async function sampleHost(at: number): Promise<HostLive> {
  const reading = await readHost();
  const traffic = { ...reading.network, ...reading.io };
  const before = previousHost;
  const seconds = before ? (at - before.at) / 1000 : 0;
  previousHost = { at, idle: reading.times.idle, total: reading.times.total, traffic };
  return {
    cpu: before ? Math.max(0, 100 * (1 - (reading.times.idle - before.idle) / Math.max(1, reading.times.total - before.total))) : 0,
    cpus: reading.cpus,
    load: reading.load,
    uptime: reading.uptime,
    memory: reading.memory,
    swap: reading.swap,
    disk: space,
    rx: rate(traffic.rx, before?.traffic.rx, seconds),
    tx: rate(traffic.tx, before?.traffic.tx, seconds),
    read: rate(traffic.read, before?.traffic.read, seconds),
    write: rate(traffic.write, before?.traffic.write, seconds),
  };
}

function add(target: string, cpu: number, memory: number, traffic: Traffic) {
  const entry = sums.get(target) ?? { seconds: 0, cpu: 0, cpuPeak: 0, memory: 0, memoryPeak: 0, net: 0, io: 0 };
  entry.seconds += 1;
  entry.cpu += cpu;
  entry.cpuPeak = Math.max(entry.cpuPeak, cpu);
  entry.memory += memory;
  entry.memoryPeak = Math.max(entry.memoryPeak, memory);
  entry.net += traffic.rx + traffic.tx;
  entry.io += traffic.read + traffic.write;
  sums.set(target, entry);
}

export function accumulate(history: Pick<History, 'record'>, frame: Frame) {
  const start = Math.floor(frame.at / 60_000) * 60_000;
  if (start !== minute && sums.size) {
    history.record(
      minute,
      [...sums].map(([target, entry]) => ({
        target,
        cpu: entry.cpu / entry.seconds,
        cpuPeak: entry.cpuPeak,
        memory: Math.round(entry.memory / entry.seconds),
        memoryPeak: entry.memoryPeak,
        net: entry.net / entry.seconds,
        io: entry.io / entry.seconds,
      })),
    );
    sums.clear();
  }
  minute = start;
  add('host', frame.host.cpu, frame.host.memory.used, frame.host);
  for (const [name, container] of Object.entries(frame.containers)) {
    add(name, container.cpu, container.memory, container);
  }
}

export function latest() {
  return frames.at(-1) ?? first;
}

export function start(history: History) {
  let busy = false;
  const tick = async () => {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const at = Date.now();
      const frame: Frame = {
        at,
        host: await sampleHost(at),
        containers: Object.fromEntries([...tracked.values()].flatMap((entry) => (entry.value ? [[entry.name, entry.value]] : []))),
      };
      frames.push(frame);
      if (frames.length > windowSeconds) {
        frames.shift();
      }
      ready(frame);
      accumulate(history, frame);
      for (const listener of listeners) {
        listener(frame);
      }
    } finally {
      busy = false;
    }
  };
  const report = (task: string) => (error: unknown) => console.error(`${task} failed:`, error);
  const measureSpace = () => diskSpace().then((value) => (space = value));
  void measureSpace().catch(report('disk space'));
  const timers = [setInterval(() => void tick().catch(report('live sample')), 1000), setInterval(() => void measureSpace().catch(report('disk space')), 30_000)];
  return () => timers.forEach(clearInterval);
}

export function serve(request: http.IncomingMessage, response: http.ServerResponse, allowed: () => Promise<boolean>) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  response.write(`retry: 3000\nevent: backlog\ndata: ${JSON.stringify(frames)}\n\n`);
  const send = (frame: Frame) => response.write(`event: frame\ndata: ${JSON.stringify(frame)}\n\n`);
  listeners.add(send);
  const check = setInterval(() => void allowed().then((still) => still || response.end(), () => response.end()), 60_000);
  request.on('close', () => {
    listeners.delete(send);
    clearInterval(check);
  });
}
