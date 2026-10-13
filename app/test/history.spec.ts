import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { History, keep, projectTotals, ranges } from '../src/server/history.ts';

const directories: string[] = [];
const minute = 60_000;

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function open() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-history-'));
  directories.push(directory);
  return new History(directory);
}

describe('History', () => {
  const now = 1000 * ranges['30d'].step;

  it('keeps 30 days of samples per target, oldest first', () => {
    const history = open();
    history.record(now - keep - 1, [{ target: 'host', cpu: 1, memory: 1 }]);
    history.record(now - 2 * minute, [{ target: 'host', cpu: 2, memory: 2 }]);
    history.record(now - minute, [
      { target: 'host', cpu: 4, memory: 4 },
      { target: 'strata-app-1', cpu: 3, memory: 3 },
    ]);
    history.record(now, [{ target: 'host', cpu: 6, memory: 6 }]);
    expect(history.series('host', '1h', now).map((point) => point.cpu)).toEqual([2, 4, 6]);
    expect(history.series('strata-app-1', '1h', now)).toHaveLength(1);
    expect(history.series('host', '30d', now - 2).map((point) => point.cpu)).not.toContain(1);
    history.close();
  });

  it('averages samples into the range step', () => {
    const history = open();
    history.record(now - 2 * minute, [{ target: 'host', cpu: 2, memory: 20 }]);
    history.record(now - minute, [{ target: 'host', cpu: 4, memory: 40 }]);
    history.record(now, [{ target: 'host', cpu: 6, memory: 60 }]);
    expect(history.series('host', '30d', now)).toEqual([
      { at: now - ranges['30d'].step, cpu: 3, memory: 30 },
      { at: now, cpu: 6, memory: 60 },
    ]);
    history.close();
  });
});

describe('projectTotals', () => {
  it("adds up each project's containers per point, in whole-machine CPU", () => {
    const series: Record<string, { at: number; cpu: number; memory: number }[]> = {
      'strata-app-1': [{ at: 1, cpu: 40, memory: 300 }, { at: 2, cpu: 20, memory: 310 }],
      'strata-postgres-1': [{ at: 1, cpu: 10, memory: 100 }],
      'console-app-1': [{ at: 2, cpu: 4, memory: 80 }],
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
      { name: 'strata', points: [{ at: 1, cpu: 25, memory: 400 }, { at: 2, cpu: 10, memory: 310 }] },
      { name: 'console', points: [{ at: 2, cpu: 2, memory: 80 }] },
    ]);
  });
});
