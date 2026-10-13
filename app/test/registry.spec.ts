import { describe, expect, it } from 'vitest';
import { ownedBy } from '../src/server/registry.ts';

const registry = {
  members: [
    { handle: 'amrmscll', github: 'AmrMsCLL' },
    { handle: 'omar-mohamed24', github: 'Omar-Mohamed24' },
  ],
  projects: [
    { slug: 'strata', owner: 'amrmscll', authors: ['AmrMsCLL'] },
    { slug: 'pixelpocket', owner: 'omar-mohamed24', authors: ['Omar-Mohamed24'] },
    { slug: 'shared', owner: 'amrmscll', authors: ['AmrMsCLL', 'omar-mohamed24'] },
  ],
};

describe('ownedBy', () => {
  it('finds projects a member owns or authored, ignoring case', () => {
    expect([...ownedBy(registry, 'omar-mohamed24')].sort()).toEqual(['pixelpocket', 'shared']);
  });

  it('finds nothing for someone outside the registry', () => {
    expect(ownedBy(registry, 'stranger').size).toBe(0);
  });
});
