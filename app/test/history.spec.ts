import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { History, keep, ranges } from '../src/server/history.ts';

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
