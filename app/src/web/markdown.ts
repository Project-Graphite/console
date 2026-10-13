import { Marked } from 'marked';

const source = 'https://github.com/project-graphite/docs/blob/main/';
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escape(text: string) {
  return text.replace(/[&<>"']/g, (character) => entities[character]);
}

export function sourceOf(path: string) {
  return source + path;
}

export function resolveLink(href: string, from: string, known: Set<string>) {
  if (/^(https?|mailto):/i.test(href)) {
    return { href, external: true };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return undefined;
  }
  if (href.startsWith('#')) {
    return { href: `#/docs/${from}`, external: false };
  }
  const path = decodeURIComponent(new URL(href.split('#')[0], `https://docs.invalid/${from}`).pathname.slice(1));
  return known.has(path) ? { href: `#/docs/${path}`, external: false } : { href: sourceOf(path), external: true };
}

function anchor(target: { href: string; external: boolean }, inner: string) {
  return `<a href="${escape(target.href)}"${target.external ? ' target="_blank" rel="noreferrer"' : ''}>${inner}</a>`;
}

export function render(markdown: string, from: string, known: Set<string>) {
  const marked = new Marked({
    gfm: true,
    renderer: {
      html: ({ text }) => escape(text),
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const target = resolveLink(href, from, known);
        return target ? anchor(target, inner) : inner;
      },
      image({ href, text }) {
        const target = resolveLink(href, from, known);
        return target ? anchor({ ...target, external: true }, escape(text || href)) : escape(text);
      },
    },
  });
  return marked.parse(markdown, { async: false });
}
