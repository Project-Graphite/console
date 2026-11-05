import { createSign } from 'node:crypto';
import { config } from './config.ts';
import { Refusal } from './refusal.ts';

const tagPattern = /^sha-[0-9a-f]{7,40}$/;
const slugPattern = /^[a-z0-9-]+$/;
let cached: { token: string; until: number } | undefined;

function credentials() {
  if (!config.platformApp) {
    throw new Refusal(503, 'Releases need PLATFORM_APP_CLIENT_ID and PLATFORM_APP_PRIVATE_KEY in the console env file.');
  }
  return config.platformApp;
}

function appToken() {
  const { clientId, privateKey } = credentials();
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: clientId })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')}`;
}

async function github<T>(path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'project-graphite-console',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Refusal(502, `GitHub answered ${response.status} for ${path.split('?')[0]}: ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

async function token() {
  if (cached && cached.until > Date.now() + 60_000) {
    return cached.token;
  }
  const jwt = appToken();
  const { id } = await github<{ id: number }>(`/repos/${config.platformRepo}/installation`, jwt);
  const created = await github<{ token: string; expires_at: string }>(`/app/installations/${id}/access_tokens`, jwt, 'POST', {
    repositories: [config.platformRepo.split('/')[1]],
    permissions: { contents: 'write' },
  });
  cached = { token: created.token, until: Date.parse(created.expires_at) };
  return created.token;
}

export function parseValues(text: string) {
  return new Map(
    text.split('\n').flatMap((line) => {
      const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
      return match ? [[match[1], match[2]] as [string, string]] : [];
    }),
  );
}

export function withValue(text: string, name: string, value: string | null) {
  const lines = text.split('\n').filter((line) => line && !line.startsWith(`${name}=`));
  return `${[...(value === null ? [] : [`${name}=${value}`]), ...lines].join('\n')}\n`;
}

export function deployedTags(commits: { commit: { message: string; author: { name: string; date: string } } }[]) {
  const seen = new Set<string>();
  return commits.flatMap(({ commit }) => {
    const tag = /\bdeploy (sha-[0-9a-f]{7,40})\b/.exec(commit.message)?.[1];
    if (!tag || seen.has(tag)) {
      return [];
    }
    seen.add(tag);
    return [{ tag, at: commit.author.date, by: /from the console by ([\w-]+)/.exec(commit.message)?.[1] ?? commit.author.name }];
  });
}

async function valuesFile(slug: string, auth: string) {
  if (!slugPattern.test(slug)) {
    throw new Refusal(400, `${slug} is not a project.`);
  }
  const file = await github<{ content: string; sha: string }>(`/repos/${config.platformRepo}/contents/deploy/${slug}/values?ref=main`, auth);
  return { text: Buffer.from(file.content, 'base64').toString('utf8'), sha: file.sha };
}

export async function release(slug: string) {
  const auth = await token();
  const [{ text }, commits] = await Promise.all([
    valuesFile(slug, auth),
    github<{ commit: { message: string; author: { name: string; date: string } } }[]>(`/repos/${config.platformRepo}/commits?path=deploy/${slug}/values&per_page=40`, auth),
  ]);
  const values = parseValues(text);
  return { current: values.get('IMAGE_TAG') ?? null, enabled: values.get('ENABLED') !== 'false', history: deployedTags(commits) };
}

async function commit(slug: string, name: string, value: string | null, message: string) {
  const auth = await token();
  const { text, sha } = await valuesFile(slug, auth);
  const next = withValue(text, name, value);
  if (next === text) {
    return null;
  }
  const result = await github<{ commit: { html_url: string } }>(`/repos/${config.platformRepo}/contents/deploy/${slug}/values`, auth, 'PUT', {
    message,
    content: Buffer.from(next).toString('base64'),
    sha,
    branch: 'main',
  });
  return result.commit.html_url;
}

export function setVersion(slug: string, tag: unknown, login: string) {
  if (typeof tag !== 'string' || !tagPattern.test(tag)) {
    throw new Refusal(400, 'A version is a sha- tag.');
  }
  return commit(slug, 'IMAGE_TAG', tag, `chore(${slug}): deploy ${tag} from the console by ${login}`);
}

export function setEnabled(slug: string, enabled: unknown, login: string) {
  if (typeof enabled !== 'boolean') {
    throw new Refusal(400, 'Say whether the project is enabled.');
  }
  return commit(slug, 'ENABLED', enabled ? null : 'false', `chore(${slug}): ${enabled ? 'enable' : 'disable'} from the console by ${login}`);
}
