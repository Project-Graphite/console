import { ErrorState } from '@project-graphite/ui';
import { useEffect, useMemo, useState } from 'react';
import type { DocPage } from '../api';
import { render, sourceOf } from '../markdown';
import { usePoll } from '../usePoll';

const sections: Record<string, string> = { '': 'Guides', reference: 'Reference', operations: 'Operations', plans: 'Plans' };

function sectionOf(path: string) {
  const folder = path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
  return sections[folder] ?? folder.charAt(0).toUpperCase() + folder.slice(1);
}

function Navigation({ pages, current, filter }: { pages: DocPage[]; current: string; filter: string }) {
  const query = filter.trim().toLowerCase();
  const shown = query ? pages.filter((page) => `${page.title}\n${page.markdown}`.toLowerCase().includes(query)) : pages;
  const groups = new Map<string, DocPage[]>();
  for (const page of shown) {
    const section = query ? 'Results' : sectionOf(page.path);
    groups.set(section, [...(groups.get(section) ?? []), page]);
  }
  return (
    <nav aria-label="Documentation" className="space-y-4">
      {[...groups].map(([section, members]) => (
        <div className="space-y-1" key={section}>
          <p className="mono-sm text-faint">{section}</p>
          {members.map((page) => (
            <a
              aria-current={page.path === current ? 'page' : undefined}
              className={`block rounded-md px-2 py-1 text-sm ${page.path === current ? 'bg-paper text-ink' : 'text-muted hover:text-ink'}`}
              href={`#/docs/${page.path}`}
              key={page.path}
            >
              {page.title}
            </a>
          ))}
        </div>
      ))}
      {shown.length === 0 && <p className="mono-sm text-faint">Nothing matches “{filter}”.</p>}
    </nav>
  );
}

export function Docs({ path }: { path: string }) {
  const { data, error, reload } = usePoll<DocPage[]>('/api/docs', 300_000);
  const [filter, setFilter] = useState('');
  const current = path || 'README.md';
  const page = data?.find((candidate) => candidate.path === current);
  const html = useMemo(() => page && data && render(page.markdown, page.path, new Set(data.map((entry) => entry.path))), [page, data]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [current]);

  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not read the handbook">{error.message}</ErrorState>;
  }
  if (!data) {
    return null;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
      <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
        <input aria-label="Search the handbook" className="w-full" onChange={(event) => setFilter(event.target.value)} placeholder="Search the handbook" type="search" value={filter} />
        <Navigation current={current} filter={filter} pages={data} />
      </aside>
      {page && html ? (
        <article className="min-w-0 space-y-4">
          <div className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
          <a className="mono-sm rule-link text-muted" href={sourceOf(page.path)} rel="noreferrer" target="_blank">
            Edit {page.path} on GitHub
          </a>
        </article>
      ) : (
        <ErrorState title="No such page">{current} is not in the handbook.</ErrorState>
      )}
    </div>
  );
}
