import { describe, expect, it } from 'vitest';
import { logQuery, resumeAfter } from '../src/server/terminal.ts';

describe('log stream', () => {
  it('follows the chosen number of lines', () => {
    expect(logQuery(new URLSearchParams('tail=1234'))).toBe('follow=1&tail=1234');
  });

  it('loads 100 lines when the number is missing or not a positive number', () => {
    expect(logQuery(new URLSearchParams())).toBe('follow=1&tail=100');
    expect(logQuery(new URLSearchParams('tail=0'))).toBe('follow=1&tail=100');
    expect(logQuery(new URLSearchParams('tail=lots'))).toBe('follow=1&tail=100');
  });

  it('caps the history at 5000 lines', () => {
    expect(logQuery(new URLSearchParams('tail=99999'))).toBe('follow=1&tail=5000');
  });

  it('reads a snapshot without following when streaming is off', () => {
    expect(logQuery(new URLSearchParams('tail=200&follow=0'))).toBe('follow=0&tail=200');
  });

  it('resumes everything after the last line it delivered', () => {
    expect(logQuery(new URLSearchParams('after=2026-10-15T10:00:00.123456789Z'))).toBe('follow=1&tail=all&since=1792058400.123456790');
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
