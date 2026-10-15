import { describe, expect, it } from 'vitest';
import { cpuPercent, Demuxer, LogLines, memoryUsed, type DockerStats } from '../src/server/docker.ts';

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
    expect(demuxer.push(bytes.subarray(0, 12)).map((frame) => String(frame.data))).toEqual([]);
    expect(demuxer.push(bytes.subarray(12)).map((frame) => [frame.stream, String(frame.data)])).toEqual([
      [1, 'first line\n'],
      [2, 'second line\n'],
    ]);
  });

  it('assembles whole log lines across chunks and splits off the timestamp', () => {
    const lines = new LogLines();
    expect(lines.push('stdout', Buffer.from('2026-10-15T10:00:00.5Z hel'))).toEqual([]);
    expect(lines.push('stdout', Buffer.from('lo\r\n2026-10-15T10:00:01Z \n2026-10-15T10:00:02Z next'))).toEqual([
      { stream: 'stdout', time: '2026-10-15T10:00:00.5Z', text: 'hello' },
      { stream: 'stdout', time: '2026-10-15T10:00:01Z', text: '' },
    ]);
  });

  it('keeps partial lines apart per stream and strips terminal colours', () => {
    const lines = new LogLines();
    expect(lines.push('stdout', Buffer.from('2026-10-15T10:00:00Z out'))).toEqual([]);
    expect(lines.push('stderr', Buffer.from('2026-10-15T10:00:00Z \u001b[31merror\u001b[0m\n'))).toEqual([
      { stream: 'stderr', time: '2026-10-15T10:00:00Z', text: 'error' },
    ]);
    expect(lines.push('stdout', Buffer.from('put\n'))).toEqual([{ stream: 'stdout', time: '2026-10-15T10:00:00Z', text: 'output' }]);
  });

  it('decodes characters split across chunks', () => {
    const lines = new LogLines();
    const bytes = Buffer.from('2026-10-15T10:00:00Z café\n');
    expect(lines.push('stdout', bytes.subarray(0, bytes.length - 2))).toEqual([]);
    expect(lines.push('stdout', bytes.subarray(bytes.length - 2))).toEqual([{ stream: 'stdout', time: '2026-10-15T10:00:00Z', text: 'café' }]);
  });
});
