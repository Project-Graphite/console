import { describe, expect, it } from 'vitest';
import { logQuery, resumeAfter } from '../src/server/terminal.ts';

describe('log stream', () => {
  it('loads the chosen amount of history', () => {
    expect(logQuery(new URLSearchParams('tail=1000'))).toBe('tail=1000');
  });

  it('loads 300 lines when the amount is missing or not offered', () => {
    expect(logQuery(new URLSearchParams())).toBe('tail=300');
    expect(logQuery(new URLSearchParams('tail=99999'))).toBe('tail=300');
  });

  it('resumes everything after the last line it delivered', () => {
    expect(logQuery(new URLSearchParams('after=2026-10-15T10:00:00.123456789Z'))).toBe('tail=all&since=1792058400.123456790');
  });

  it('resumes one nanosecond after timestamps of any precision', () => {
    expect(resumeAfter('2026-10-15T10:00:00Z')).toBe('1792058400.000000001');
    expect(resumeAfter('2026-10-15T10:00:00.5Z')).toBe('1792058400.500000001');
    expect(resumeAfter('2026-10-15T10:00:00.999999999Z')).toBe('1792058401.000000000');
  });

  it('refuses a resume point that is not a Docker timestamp', () => {
    expect(() => resumeAfter('yesterday')).toThrow('not a Docker log timestamp');
  });
});
