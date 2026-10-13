import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Access, permits, scopePattern } from '../src/server/access.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function open() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-access-'));
  directories.push(directory);
  return new Access(directory);
}

describe('Access', () => {
  it('stores a member\'s access under their lowercase login', () => {
    const access = open();
    access.grant('Omar-Mohamed24', ['project:strata', 'area:shell', 'project:strata']);
    expect(access.scopes('omar-mohamed24')).toEqual(['area:shell', 'project:strata']);
    access.grant('omar-mohamed24', []);
    expect(access.scopes('Omar-Mohamed24')).toEqual([]);
    access.close();
  });

  it('remembers when a member was last seen without touching their access', () => {
    const access = open();
    access.grant('someone', ['*']);
    access.seen('Someone', 1000);
    expect(access.all()).toEqual([{ login: 'someone', scopes: ['*'], seen: 1000 }]);
    access.close();
  });
});

describe('permits', () => {
  it('grants a scope that is listed, or everything with *', () => {
    expect(permits(['project:strata'], 'project:strata')).toBe(true);
    expect(permits(['project:strata'], 'project:pixelpocket')).toBe(false);
    expect(permits(['*'], 'area:shell')).toBe(true);
    expect(permits([], 'area:images')).toBe(false);
  });

  it('accepts only known scopes', () => {
    expect(['*', 'area:shell', 'area:images', 'project:graphite-tracker'].every((scope) => scopePattern.test(scope))).toBe(true);
    expect(['owner', 'area:admin', 'project:', 'project:../x'].some((scope) => scopePattern.test(scope))).toBe(false);
  });
});
