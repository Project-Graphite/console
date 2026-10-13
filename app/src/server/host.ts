import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { config } from './config.ts';

let previous: { idle: number; total: number } | undefined;

export function cpuTimes(stat: string) {
  const fields = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  const idle = fields[3] + (fields[4] ?? 0);
  return { idle, total: fields.reduce((sum, value) => sum + value, 0) };
}

export function meminfo(text: string) {
  const values = Object.fromEntries(
    text.split('\n').flatMap((line) => {
      const match = /^(\w+):\s+(\d+) kB/.exec(line);
      return match ? [[match[1], Number(match[2]) * 1024]] : [];
    }),
  );
  return {
    memory: { used: values.MemTotal - values.MemAvailable, total: values.MemTotal },
    swap: { used: values.SwapTotal - values.SwapFree, total: values.SwapTotal },
  };
}

export async function hostStats() {
  const [stat, memory, load, uptime, disk] = await Promise.all([
    readFile('/proc/stat', 'utf8'),
    readFile('/proc/meminfo', 'utf8'),
    readFile('/proc/loadavg', 'utf8'),
    readFile('/proc/uptime', 'utf8'),
    statfs(config.hostRoot).catch(() => statfs('/')),
  ]);
  const times = cpuTimes(stat);
  const cpu = previous ? 100 * (1 - (times.idle - previous.idle) / Math.max(1, times.total - previous.total)) : 0;
  previous = times;
  return {
    cpu: Math.max(0, cpu),
    cpus: os.cpus().length,
    load: load.split(' ').slice(0, 3).map(Number),
    uptime: Number(uptime.split(' ')[0]),
    disk: { used: (disk.blocks - disk.bfree) * disk.bsize, total: disk.blocks * disk.bsize },
    ...meminfo(memory),
  };
}
