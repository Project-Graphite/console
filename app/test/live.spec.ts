import { describe, expect, it } from 'vitest';
import type { Sample } from '../src/server/history.ts';
import { accumulate, rate, type Frame } from '../src/server/live.ts';

const traffic = (rx: number, tx: number, read: number, write: number) => ({ rx, tx, read, write });

function frame(at: number, hostCpu: number, hostMemory: number, appCpu: number, appMemory: number): Frame {
  return {
    at,
    host: { cpu: hostCpu, cpus: 2, load: [0, 0, 0], uptime: 1, memory: { used: hostMemory, total: 100 }, swap: { used: 0, total: 0 }, disk: { used: 0, total: 0 }, ...traffic(10, 20, 30, 40) },
    containers: { 'strata-app-1': { project: 'strata', cpu: appCpu, cpuLimit: 0.75, memory: appMemory, memoryLimit: 512, ...traffic(1, 2, 3, 4) } },
  };
}

describe('rate', () => {
  it('turns two counter readings into a per-second rate, never negative', () => {
    expect(rate(3000, 1000, 2)).toBe(1000);
    expect(rate(500, 1000, 2)).toBe(0);
    expect(rate(3000, undefined, 2)).toBe(0);
    expect(rate(3000, 1000, 0)).toBe(0);
  });
});

describe('accumulate', () => {
  it('records each minute as the average and peak of its seconds', () => {
    const recorded: { at: number; samples: Sample[] }[] = [];
    const history = { record: (at: number, samples: Sample[]) => recorded.push({ at, samples }) };
    accumulate(history, frame(60_000, 10, 40, 50, 200));
    accumulate(history, frame(61_000, 30, 60, 70, 100));
    expect(recorded).toEqual([]);
    accumulate(history, frame(120_000, 5, 5, 5, 5));
    expect(recorded).toEqual([
      {
        at: 60_000,
        samples: [
          { target: 'host', cpu: 20, cpuPeak: 30, memory: 50, memoryPeak: 60, net: 30, io: 70 },
          { target: 'strata-app-1', cpu: 60, cpuPeak: 70, memory: 150, memoryPeak: 200, net: 3, io: 7 },
        ],
      },
    ]);
  });
});
