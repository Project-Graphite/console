import { describe, expect, it } from 'vitest';
import { cpuTimes, diskBytes, meminfo, networkBytes } from '../src/server/host.ts';

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

  it('counts traffic on physical interfaces only, from /proc/net/dev', () => {
    const text = [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo: 9000 10 0 0 0 0 0 0 9000 10 0 0 0 0 0 0',
      '  eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0',
      'docker0: 500 5 0 0 0 0 0 0 600 6 0 0 0 0 0 0',
      'veth12ab: 70 1 0 0 0 0 0 0 80 1 0 0 0 0 0 0',
      'br-1f2e: 70 1 0 0 0 0 0 0 80 1 0 0 0 0 0 0',
      '  ens4: 300 3 0 0 0 0 0 0 400 4 0 0 0 0 0 0',
    ].join('\n');
    expect(networkBytes(text)).toEqual({ rx: 1300, tx: 2400 });
  });

  it('counts sectors read and written on whole disks, from /proc/diskstats', () => {
    const text = ['   8       0 sda 10 0 100 0 20 0 200 0 0 0 0', '   8       1 sda1 10 0 100 0 20 0 200 0 0 0 0', ' 252       0 vda 1 0 4 0 2 0 8 0 0 0 0', '   7       0 loop0 1 0 50 0 0 0 0 0 0 0 0'].join(
      '\n',
    );
    expect(diskBytes(text)).toEqual({ read: 104 * 512, write: 208 * 512 });
  });
});
