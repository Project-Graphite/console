import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { History, keep } from '../src/server/history.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('History', () => {
  it('keeps 24 hours of samples per target, oldest first', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'console-history-'));
    directories.push(directory);
    const history = new History(directory);
    const now = Date.now();
    history.record(now - keep - 1, [{ target: 'host', cpu: 1, memory: 1 }]);
    history.record(now - 1000, [
      { target: 'host', cpu: 2, memory: 2 },
      { target: 'strata-app-1', cpu: 3, memory: 3 },
    ]);
    history.record(now, [{ target: 'host', cpu: 4, memory: 4 }]);
    expect(history.series('host').map((point) => point.cpu)).toEqual([2, 4]);
    expect(history.series('strata-app-1')).toHaveLength(1);
    history.close();
  });
});
