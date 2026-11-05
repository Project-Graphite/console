import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { config } from './config.ts';

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

export function networkBytes(text: string) {
  return text
    .split('\n')
    .slice(2)
    .map((line) => line.trim().split(/[:\s]+/))
    .filter((fields) => fields.length > 9 && !/^(lo|veth|br-|docker)/.test(fields[0]))
    .reduce((sum, fields) => ({ rx: sum.rx + Number(fields[1]), tx: sum.tx + Number(fields[9]) }), { rx: 0, tx: 0 });
}

export function diskBytes(text: string) {
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => /^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+)$/.test(fields[2] ?? ''))
    .reduce((sum, fields) => ({ read: sum.read + Number(fields[5]) * 512, write: sum.write + Number(fields[9]) * 512 }), { read: 0, write: 0 });
}

export async function readHost() {
  const [stat, memory, load, uptime, network, disks] = await Promise.all(
    ['/proc/stat', '/proc/meminfo', '/proc/loadavg', '/proc/uptime', '/proc/1/net/dev', '/proc/diskstats'].map((file) => readFile(file, 'utf8')),
  );
  return {
    times: cpuTimes(stat),
    cpus: os.cpus().length,
    load: load.split(' ').slice(0, 3).map(Number),
    uptime: Number(uptime.split(' ')[0]),
    ...meminfo(memory),
    network: networkBytes(network),
    io: diskBytes(disks),
  };
}

export async function diskSpace() {
  const disk = await statfs(config.hostRoot).catch(() => statfs('/'));
  return { used: (disk.blocks - disk.bfree) * disk.bsize, total: (disk.blocks - disk.bfree + disk.bavail) * disk.bsize };
}
