import { describe, expect, it } from 'vitest';
import { cpuPercent, Demuxer, memoryUsed, type DockerStats } from '../src/server/docker.ts';

const stats: DockerStats = {
  cpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000, online_cpus: 2 },
  precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
  memory_stats: { usage: 500, limit: 1000, stats: { inactive_file: 100 } },
};

function frame(stream: number, text: string) {
  const body = Buffer.from(text);
  const header = Buffer.alloc(8);
  header[0] = stream;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

describe('docker', () => {
  it('computes CPU like docker stats, scaled by the online CPUs', () => {
    expect(cpuPercent(stats)).toBe(40);
  });

  it('reports zero CPU before a second sample exists', () => {
    expect(cpuPercent({ ...stats, precpu_stats: { cpu_usage: { total_usage: 300 }, system_cpu_usage: 2000 } })).toBe(0);
  });

  it('subtracts the page cache from memory use', () => {
    expect(memoryUsed(stats)).toBe(400);
  });

  it('splits multiplexed log frames even when a frame spans chunks', () => {
    const demuxer = new Demuxer();
    const bytes = Buffer.concat([frame(1, 'first line\n'), frame(2, 'second line\n')]);
    expect(demuxer.push(bytes.subarray(0, 12)).map(String)).toEqual([]);
    expect(demuxer.push(bytes.subarray(12)).map(String)).toEqual(['first line\n', 'second line\n']);
  });
});
