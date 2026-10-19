import { describe, expect, it } from 'vitest';
import { order, titleOf } from '../src/server/docs.ts';

describe('handbook order', () => {
  it('follows the README links, then lists the rest alphabetically', () => {
    const readme = '| [overview.md](overview.md) | [vps](operations/vps.md#first) | [gone](missing.md) | [overview again](./overview.md) |';
    expect(order(['plans/k3s.md', 'operations/vps.md', 'README.md', 'overview.md', 'decisions.md'], readme)).toEqual([
      'README.md',
      'overview.md',
      'operations/vps.md',
      'decisions.md',
      'plans/k3s.md',
    ]);
  });

  it('titles a page by its first heading', () => {
    expect(titleOf('operations/vps.md', 'intro\n# The VPS\n## Setup')).toBe('The VPS');
    expect(titleOf('notes.md', 'no heading')).toBe('notes.md');
  });
});
