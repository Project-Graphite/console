import { describe, expect, it } from 'vitest';
import { cpuTimes, meminfo } from '../src/server/host.ts';

describe('host', () => {
  it('reads total and idle time from /proc/stat', () => {
    expect(cpuTimes('cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4\n')).toEqual({ idle: 850, total: 1000 });
  });

  it('reads memory and swap from /proc/meminfo', () => {
    const text = 'MemTotal:       4000 kB\nMemFree:  100 kB\nMemAvailable:   1000 kB\nSwapTotal:      2000 kB\nSwapFree:       1500 kB\n';
    expect(meminfo(text)).toEqual({
      memory: { used: 3000 * 1024, total: 4000 * 1024 },
      swap: { used: 500 * 1024, total: 2000 * 1024 },
    });
  });
});
