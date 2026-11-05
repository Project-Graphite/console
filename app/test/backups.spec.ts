import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { backupConditions, defaultSchedule, listBackups, nextRun, order, readSchedule, requests, upload, writeSchedule } from '../src/server/backups.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function root() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-backups-'));
  directories.push(directory);
  return directory;
}

const summary = (project: string, stamp: string) => JSON.stringify({ project, stamp, started: '', ok: true, errors: [], items: [] });

describe('schedule', () => {
  const at = (text: string) => Date.parse(text);

  it('runs at the anchor hour and every period after it, in UTC', () => {
    expect(nextRun(defaultSchedule, at('2026-11-05T02:59:00Z'))).toBe(at('2026-11-05T03:00:00Z'));
    expect(nextRun(defaultSchedule, at('2026-11-05T03:00:01Z'))).toBe(at('2026-11-06T03:00:00Z'));
    expect(nextRun({ ...defaultSchedule, everyHours: 6 }, at('2026-11-05T10:00:00Z'))).toBe(at('2026-11-05T15:00:00Z'));
  });

  it('keeps a valid schedule, refuses an invalid one and defaults to daily at 03:00 for 14 days', async () => {
    const base = root();
    expect(await readSchedule(base)).toEqual(defaultSchedule);
    await writeSchedule({ enabled: false, everyHours: 12, hour: 1, keepDays: 30 }, 'amr', base);
    expect(await readSchedule(base)).toEqual({ enabled: false, everyHours: 12, hour: 1, keepDays: 30 });
    await expect(writeSchedule({ enabled: true, everyHours: 5, hour: 1, keepDays: 30 }, 'amr', base)).rejects.toThrow('A schedule is');
    await expect(writeSchedule({ enabled: true, everyHours: 24, hour: 24, keepDays: 30 }, 'amr', base)).rejects.toThrow('A schedule is');
  });

  it('raises no late-backup alert while backups are off, and allows the whole period plus two hours', async () => {
    const base = root();
    mkdirSync(path.join(base, 'strata'));
    writeFileSync(path.join(base, 'strata', '20261101T030000Z.json'), summary('strata', '20261101T030000Z'));
    const now = Date.parse('2026-11-03T04:00:00Z');
    expect((await backupConditions(now, base)).map((entry) => entry.key)).toEqual(['backup:strata']);
    await writeSchedule({ enabled: true, everyHours: 72, hour: 3, keepDays: 14 }, 'amr', base);
    expect(await backupConditions(now, base)).toEqual([]);
    await writeSchedule({ enabled: false, everyHours: 24, hour: 3, keepDays: 14 }, 'amr', base);
    expect(await backupConditions(Date.parse('2026-11-30T00:00:00Z'), base)).toEqual([]);
  });
});

describe('backups', () => {
  it('lists every project and its runs, newest first, ignoring stray files', async () => {
    const base = root();
    mkdirSync(path.join(base, 'strata'));
    mkdirSync(path.join(base, '.requests'));
    writeFileSync(path.join(base, 'strata', '20261104T030000Z.json'), summary('strata', '20261104T030000Z'));
    writeFileSync(path.join(base, 'strata', '20261105T030000Z.json'), summary('strata', '20261105T030000Z'));
    writeFileSync(path.join(base, 'strata', '20261105T030000Z.tar'), '');
    writeFileSync(path.join(base, 'strata', '20261106T030000Z.json.partial'), '');
    expect((await listBackups(base)).map(({ project, archives }) => [project, archives.map((archive) => archive.stamp)])).toEqual([
      ['strata', ['20261105T030000Z', '20261104T030000Z']],
    ]);
    expect(await listBackups(path.join(base, 'missing'))).toEqual([]);
  });

  it('orders a run for the backup service and reports its state', async () => {
    const base = root();
    const id = await order('run', 'strata', 'amr', undefined, base);
    expect(JSON.parse(readFileSync(path.join(base, '.requests', `${id}.request`), 'utf8'))).toEqual({ action: 'run', project: 'strata', by: 'amr' });
    expect((await requests(base)).map((entry) => [entry.id, entry.state])).toEqual([[id, 'waiting']]);
    writeFileSync(path.join(base, '.requests', `${id}.result`), JSON.stringify({ action: 'run', project: 'strata', by: 'amr', ok: false, output: 'boom', at: '2026-11-05T03:00:00Z' }));
    rmSync(path.join(base, '.requests', `${id}.request`));
    expect((await requests(base)).map((entry) => [entry.state, entry.output])).toEqual([['failed', 'boom']]);
    await expect(order('restore', 'strata', 'amr', 'missing.tar', base)).rejects.toThrow('There is no strata/missing.tar.');
    await expect(order('run', '../etc', 'amr', undefined, base)).rejects.toThrow('is not a project name');
  });

  it('stores an uploaded archive, asks for its verification and audits both', async () => {
    const base = root();
    const result = await upload(Readable.from([Buffer.from('tar bytes')]) as IncomingMessage, 'console', 'amr', new Date('2026-11-05T12:34:56.789Z'), base);
    expect(result.stamp).toBe('20261105T123456Z');
    expect(readFileSync(path.join(base, 'console', '20261105T123456Z.tar'), 'utf8')).toBe('tar bytes');
    expect(readdirSync(path.join(base, 'console'))).toEqual(['20261105T123456Z.tar']);
    expect(JSON.parse(readFileSync(path.join(base, '.requests', `${result.id}.request`), 'utf8'))).toMatchObject({ action: 'verify', archive: '20261105T123456Z.tar' });
    expect(
      readFileSync(path.join(base, 'audit.log'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line).action),
    ).toEqual(['import', 'verify']);
  });
});
