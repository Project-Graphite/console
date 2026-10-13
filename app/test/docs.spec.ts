import { describe, expect, it } from 'vitest';
import { order, titleOf } from '../src/server/docs.ts';
import { render, resolveLink } from '../src/web/markdown.ts';

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

describe('handbook links', () => {
  const known = new Set(['README.md', 'reference/registry.md', 'operations/console.md']);

  it('keeps handbook links inside the console and sends the rest to GitHub', () => {
    expect(resolveLink('../reference/registry.md#fields', 'operations/console.md', known)).toEqual({ href: '#/docs/reference/registry.md', external: false });
    expect(resolveLink('../brand/logo.svg', 'operations/console.md', known)).toEqual({
      href: 'https://github.com/project-graphite/docs/blob/main/brand/logo.svg',
      external: true,
    });
    expect(resolveLink('https://example.com', 'README.md', known)).toEqual({ href: 'https://example.com', external: true });
  });

  it('drops links with any other scheme', () => {
    expect(resolveLink('javascript:alert(1)', 'README.md', known)).toBeUndefined();
    expect(render('[click](javascript:alert(1))', 'README.md', known)).not.toContain('href');
  });

  it('shows raw HTML as text', () => {
    const html = render('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>', 'README.md', known);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });
});
