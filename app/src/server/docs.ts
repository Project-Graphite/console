import { config } from './config.ts';

export interface DocPage {
  path: string;
  title: string;
  markdown: string;
}

const ttl = 5 * 60 * 1000;
let cached: { at: number; pages: DocPage[] } | undefined;

async function text(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'project-graphite-console' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return response.text();
}

export function order(paths: string[], readme: string) {
  const linked = [...readme.matchAll(/\]\((?:\.\/)?([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map((match) => match[1]);
  const known = new Set(paths);
  return [...new Set(['README.md', ...linked, ...[...paths].sort()])].filter((path) => known.has(path));
}

export function titleOf(path: string, markdown: string) {
  return /^#\s+(.+)$/m.exec(markdown)?.[1].trim() ?? path;
}

async function load() {
  const { tree } = JSON.parse(await text(`https://api.github.com/repos/${config.docsRepo}/git/trees/main?recursive=1`)) as {
    tree: { path: string; type: string }[];
  };
  const paths = tree.filter((entry) => entry.type === 'blob' && entry.path.endsWith('.md') && !entry.path.startsWith('.github/')).map((entry) => entry.path);
  const sources = new Map(
    await Promise.all(paths.map(async (path) => [path, await text(`https://raw.githubusercontent.com/${config.docsRepo}/main/${path}`)] as const)),
  );
  return order(paths, sources.get('README.md') ?? '').map((path) => ({ path, title: titleOf(path, sources.get(path)!), markdown: sources.get(path)! }));
}

export async function docs() {
  if (cached && Date.now() - cached.at < ttl) {
    return cached.pages;
  }
  try {
    cached = { at: Date.now(), pages: await load() };
  } catch (error) {
    if (!cached) {
      throw error;
    }
  }
  return cached.pages;
}
