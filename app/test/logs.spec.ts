import { describe, expect, it } from 'vitest';
import { entryDetail, formatTime, levelOf, segments } from '../src/web/logs.ts';

describe('log viewer', () => {
  it('reads the level from the words in a line', () => {
    expect(levelOf('worker failed to connect')).toBe('error');
    expect(levelOf('[warn] disk is filling up')).toBe('warning');
    expect(levelOf('debug: cache hit')).toBe('debug');
    expect(levelOf('listening on 8000')).toBe('info');
  });

  it('does not take a level from part of a word', () => {
    expect(levelOf('terror and warning-free')).toBe('warning');
    expect(levelOf('errand runner')).toBe('info');
  });

  it('splits text around every case-insensitive match', () => {
    expect(segments('GET /up 200 get', 'get')).toEqual([
      { text: 'GET', match: true },
      { text: ' /up 200 ', match: false },
      { text: 'get', match: true },
    ]);
    expect(segments('plain', '')).toEqual([{ text: 'plain', match: false }]);
  });

  it('formats Docker timestamps as year-month-day and 24-hour time', () => {
    expect(formatTime('2026-10-15T10:00:00.123456789Z')).toMatch(/^2026-Oct-1[45] \d\d:\d\d:00$/);
  });

  it('pretty-prints JSON entries and leaves other text alone', () => {
    expect(entryDetail('{"level":"info","msg":"ok"}')).toBe('{\n  "level": "info",\n  "msg": "ok"\n}');
    expect(entryDetail('not json')).toBe('not json');
  });
});
