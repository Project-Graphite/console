import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { levelOf, LogStore } from '../src/server/logstore.ts';

const stores: LogStore[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function open() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-logs-'));
  directories.push(directory);
  const store = new LogStore(directory, 7);
  stores.push(store);
  return store;
}

const line = (second: number, container: string, text: string, stream: 'stdout' | 'stderr' = 'stdout') => ({
  time: `2026-11-05T10:00:${String(second).padStart(2, '0')}.000000001Z`,
  project: container.split('-')[0],
  service: container.split('-')[1],
  container,
  stream,
  text,
});

describe('levelOf', () => {
  it('reads the level from the words in a line', () => {
    expect(['Error: boom', 'WARN slow query', 'debug tick', 'listening on 3000'].map(levelOf)).toEqual(['error', 'warning', 'debug', 'info']);
  });
});

describe('LogStore', () => {
  it('stores lines with their level and filters by project, container, stream, level and text', () => {
    const store = open();
    store.add(line(1, 'strata-app-1', 'listening on 3000'));
    store.add(line(2, 'strata-app-1', 'Error: 100% failed', 'stderr'));
    store.add(line(3, 'strata-postgres-1', 'checkpoint complete'));
    store.add(line(4, 'console-app-1', 'WARN slow'));
    store.flush();
    const texts = (filter: Parameters<LogStore['query']>[0]) => store.query(filter).lines.map((entry) => entry.text);
    expect(texts({})).toEqual(['WARN slow', 'checkpoint complete', 'Error: 100% failed', 'listening on 3000']);
    expect(texts({ projects: ['strata'] })).toHaveLength(3);
    expect(texts({ containers: ['strata-postgres-1'] })).toEqual(['checkpoint complete']);
    expect(texts({ streams: ['stderr'] })).toEqual(['Error: 100% failed']);
    expect(texts({ levels: ['warning', 'error'] })).toEqual(['WARN slow', 'Error: 100% failed']);
    expect(texts({ text: '100%' })).toEqual(['Error: 100% failed']);
    expect(texts({ text: '%' })).toEqual(['Error: 100% failed']);
    expect(store.cursor('strata-app-1')).toBe('2026-11-05T10:00:02.000000001Z');
  });

  it('pages back with before and forward with after', () => {
    const store = open();
    for (let second = 0; second < 5; second += 1) {
      store.add(line(second, 'strata-app-1', `line ${second}`));
    }
    store.flush();
    const first = store.query({ limit: 2 });
    expect([first.lines.map((entry) => entry.text), first.more]).toEqual([['line 4', 'line 3'], true]);
    const older = store.query({ limit: 2, before: first.lines.at(-1)!.id });
    expect(older.lines.map((entry) => entry.text)).toEqual(['line 2', 'line 1']);
    expect(store.query({ after: first.lines[1].id }).lines.map((entry) => entry.text)).toEqual(['line 4']);
  });

  it('forgets lines older than the retention and reports what it holds', () => {
    const store = open();
    store.add(line(1, 'strata-app-1', 'old'));
    store.add({ ...line(2, 'strata-app-1', 'Error: new'), time: '2026-11-12T10:00:00Z' });
    store.flush();
    store.prune(Date.parse('2026-11-12T12:00:00Z'));
    expect(store.query({}).lines.map((entry) => entry.text)).toEqual(['Error: new']);
    expect(store.stats()).toMatchObject({ lines: 1, errors: 1, oldest: Date.parse('2026-11-12T10:00:00Z') });
  });
});
