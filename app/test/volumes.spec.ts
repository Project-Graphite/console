import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inside, listFiles } from '../src/server/volumes.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function volumes() {
  const base = mkdtempSync(path.join(tmpdir(), 'console-volumes-'));
  directories.push(base);
  const data = path.join(base, 'strata_files-data', '_data');
  mkdirSync(path.join(data, 'uploads'), { recursive: true });
  writeFileSync(path.join(data, 'uploads', 'a.png'), 'png');
  writeFileSync(path.join(data, 'notes.txt'), 'hello');
  writeFileSync(path.join(base, 'secret.txt'), 'outside');
  return base;
}

describe('volumes', () => {
  it('lists a folder of a volume, folders first', async () => {
    const base = volumes();
    expect((await listFiles('strata_files-data', '', base)).map((entry) => [entry.name, entry.kind])).toEqual([
      ['uploads', 'folder'],
      ['notes.txt', 'file'],
    ]);
    expect((await listFiles('strata_files-data', 'uploads', base)).map((entry) => [entry.name, entry.size])).toEqual([['a.png', 3]]);
  });

  it('resolves inside a volume reached through a linked root, as /proc/1/root is', async () => {
    const base = volumes();
    const linked = `${base}-linked`;
    directories.push(linked);
    try {
      symlinkSync(base, linked, 'junction');
    } catch {
      return;
    }
    expect((await listFiles('strata_files-data', 'uploads', linked)).map((entry) => entry.name)).toEqual(['a.png']);
  });

  it('refuses paths and links that lead out of the volume, and names that are not volumes', async () => {
    const base = volumes();
    await expect(inside('strata_files-data', '../../secret.txt', base)).rejects.toThrow('leads out of the volume');
    await expect(inside('../strata_files-data', '', base)).rejects.toThrow('is not a volume name');
    await expect(inside('missing', '', base)).rejects.toThrow('There is no volume missing.');
    try {
      symlinkSync(path.join(base, 'secret.txt'), path.join(base, 'strata_files-data', '_data', 'escape'));
    } catch {
      return;
    }
    await expect(inside('strata_files-data', 'escape', base)).rejects.toThrow('leads out of the volume');
  });
});
