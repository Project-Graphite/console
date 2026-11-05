import { describe, expect, it } from 'vitest';
import { deployedTags, parseValues, withValue } from '../src/server/platform.ts';

describe('values', () => {
  const text = 'IMAGE_TAG=sha-1111111\nAPP_MEMORY=512M\n';

  it('sets a value as the first line, replaces it, and removes it', () => {
    expect(withValue(text, 'IMAGE_TAG', 'sha-2222222')).toBe('IMAGE_TAG=sha-2222222\nAPP_MEMORY=512M\n');
    expect(withValue(text, 'ENABLED', 'false')).toBe('ENABLED=false\nIMAGE_TAG=sha-1111111\nAPP_MEMORY=512M\n');
    expect(withValue('ENABLED=false\nIMAGE_TAG=sha-1111111\n', 'ENABLED', null)).toBe('IMAGE_TAG=sha-1111111\n');
  });

  it('reads NAME=value lines', () => {
    expect(Object.fromEntries(parseValues('IMAGE_TAG=sha-1\nURL=https://a=b\n\n'))).toEqual({ IMAGE_TAG: 'sha-1', URL: 'https://a=b' });
  });
});

describe('deployedTags', () => {
  it('lists each deployed tag once, newest first, with who deployed it', () => {
    const commit = (message: string, name: string, date: string) => ({ commit: { message, author: { name, date } } });
    expect(
      deployedTags([
        commit('chore(strata): deploy sha-3333333 from the console by AmrMsCLL', 'graphite-deploy', '2026-11-05T12:00:00Z'),
        commit('chore(strata): disable from the console by AmrMsCLL', 'graphite-deploy', '2026-11-05T11:00:00Z'),
        commit('chore(strata): deploy sha-2222222', 'graphite-deploy', '2026-11-05T10:00:00Z'),
        commit('chore(strata): deploy sha-3333333', 'graphite-deploy', '2026-11-05T09:00:00Z'),
        commit('feat: plain compose', 'Amr', '2026-11-04T09:00:00Z'),
      ]),
    ).toEqual([
      { tag: 'sha-3333333', at: '2026-11-05T12:00:00Z', by: 'AmrMsCLL' },
      { tag: 'sha-2222222', at: '2026-11-05T10:00:00Z', by: 'graphite-deploy' },
    ]);
  });
});
