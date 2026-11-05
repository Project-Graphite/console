import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { History, keep, projectTotals, ranges } from '../src/server/history.ts';

const directories: string[] = [];
const minute = 60_000;

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function folder() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-history-'));
  directories.push(directory);
  return directory;
}

const sample = (target: string, cpu: number, memory: number, extra: { cpuPeak?: number; memoryPeak?: number; net?: number; io?: number } = {}) => ({
  target,
  cpu,
  cpuPeak: extra.cpuPeak ?? cpu,
  memory,
  memoryPeak: extra.memoryPeak ?? memory,
  net: extra.net ?? 0,
  io: extra.io ?? 0,
});

describe('History', () => {
  const now = 1000 * ranges['30d'].step;

  it('keeps 30 days of samples per target, oldest first', () => {
    const history = new History(folder());
    history.record(now - keep - 1, [sample('host', 1, 1)]);
    history.record(now - 2 * minute, [sample('host', 2, 2)]);
    history.record(now - minute, [sample('host', 4, 4), sample('strata-app-1', 3, 3)]);
    history.record(now, [sample('host', 6, 6)]);
    expect(history.series('host', '1h', now).map((point) => point.cpu)).toEqual([2, 4, 6]);
    expect(history.series('strata-app-1', '1h', now)).toHaveLength(1);
    expect(history.series('host', '30d', now - 2).map((point) => point.cpu)).not.toContain(1);
    history.close();
  });

  it('averages samples into the range step and keeps the highest peak', () => {
    const history = new History(folder());
    history.record(now - 2 * minute, [sample('host', 2, 20, { cpuPeak: 9, memoryPeak: 25, net: 100, io: 10 })]);
    history.record(now - minute, [sample('host', 4, 40, { cpuPeak: 5, memoryPeak: 70, net: 300, io: 30 })]);
    history.record(now, [sample('host', 6, 60)]);
    expect(history.series('host', '30d', now)).toEqual([
      { at: now - ranges['30d'].step, cpu: 3, cpuPeak: 9, memory: 30, memoryPeak: 70, net: 200, io: 20 },
      { at: now, cpu: 6, cpuPeak: 6, memory: 60, memoryPeak: 60, net: 0, io: 0 },
    ]);
    history.close();
  });

  it('reads samples written before peaks and traffic were kept, using the average as the peak', () => {
    const directory = folder();
    const legacy = new DatabaseSync(path.join(directory, 'metrics.db'));
    legacy.exec('CREATE TABLE samples (at INTEGER NOT NULL, target TEXT NOT NULL, cpu REAL NOT NULL, memory INTEGER NOT NULL)');
    legacy.prepare('INSERT INTO samples VALUES (?, ?, ?, ?)').run(now, 'host', 7, 70);
    legacy.close();
    const history = new History(directory);
    expect(history.series('host', '1h', now)).toEqual([{ at: now, cpu: 7, cpuPeak: 7, memory: 70, memoryPeak: 70, net: 0, io: 0 }]);
    history.close();
  });
});

describe('projectTotals', () => {
  it("adds up each project's containers per point, in whole-machine CPU", () => {
    const point = (at: number, cpu: number, memory: number) => ({ at, cpu, cpuPeak: cpu, memory, memoryPeak: memory, net: 1, io: 2 });
    const series: Record<string, ReturnType<typeof point>[]> = {
      'strata-app-1': [point(1, 40, 300), point(2, 20, 310)],
      'strata-postgres-1': [point(1, 10, 100)],
      'console-app-1': [point(2, 4, 80)],
      'graphite-message-lab-web-1': [],
    };
    const totals = projectTotals(
      [
        { name: 'strata-app-1', project: 'strata' },
        { name: 'strata-postgres-1', project: 'strata' },
        { name: 'console-app-1', project: 'console' },
        { name: 'graphite-message-lab-web-1', project: 'graphite-message-lab' },
      ],
      (name) => series[name],
      2,
    );
    expect(totals).toEqual([
      {
        name: 'strata',
        points: [
          { at: 1, cpu: 25, cpuPeak: 25, memory: 400, memoryPeak: 400, net: 2, io: 4 },
          { at: 2, cpu: 10, cpuPeak: 10, memory: 310, memoryPeak: 310, net: 1, io: 2 },
        ],
      },
      { name: 'console', points: [{ at: 2, cpu: 2, cpuPeak: 2, memory: 80, memoryPeak: 80, net: 1, io: 2 }] },
    ]);
  });
});
