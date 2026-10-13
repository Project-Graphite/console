import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type webcrypto } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.ts';

export interface User {
  login: string;
  owner: boolean;
}

const sessionCookie = 'console_session';
const stateCookie = 'console_state';
const sessionHours = 8;
export const recheckMs = 60_000;

const members = new Map<string, { token: string; owner: boolean; checked: number }>();

function sign(value: string) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function seal(user: User, now = Date.now()) {
  const value = Buffer.from(JSON.stringify({ ...user, exp: now + sessionHours * 3600_000 })).toString('base64url');
  return `${value}.${sign(value)}`;
}

export function unseal(token: string | undefined, now = Date.now()): User | undefined {
  const [value, signature] = token?.split('.') ?? [];
  if (!value || !signature) {
    return undefined;
  }
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return undefined;
  }
  const session = JSON.parse(Buffer.from(value, 'base64url').toString()) as User & { exp: number };
  return session.exp > now ? { login: session.login, owner: session.owner } : undefined;
}

export function cookies(request: IncomingMessage) {
  return Object.fromEntries(
    (request.headers.cookie ?? '').split(';').flatMap((part) => {
      const index = part.indexOf('=');
      return index > 0 ? [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]] : [];
    }),
  );
}

function setCookie(response: ServerResponse, name: string, value: string, maxAge: number) {
  const secure = config.production ? '; Secure' : '';
  response.appendHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

let certificates: { at: number; keys: (webcrypto.JsonWebKey & { kid: string })[] } | undefined;

async function accessKeys(team: string, refresh: boolean) {
  if (!certificates || refresh || Date.now() - certificates.at > 3600_000) {
    const response = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
    certificates = { at: Date.now(), keys: ((await response.json()) as { keys: (webcrypto.JsonWebKey & { kid: string })[] }).keys };
  }
  return certificates.keys;
}

export async function verifyAccess(
  token: string | undefined,
  access: { team: string; audience: string },
  keys = accessKeys,
  now = Date.now(),
) {
  const [header, payload, signature] = token?.split('.') ?? [];
  if (!header || !payload || !signature) {
    return false;
  }
  const { alg, kid } = JSON.parse(Buffer.from(header, 'base64url').toString()) as { alg: string; kid: string };
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { aud: string | string[]; exp: number; iss: string };
  const key = (await keys(access.team, false)).find((candidate) => candidate.kid === kid) ??
    (await keys(access.team, true)).find((candidate) => candidate.kid === kid);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return (
    alg === 'RS256' &&
    key !== undefined &&
    verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url')) &&
    audiences.includes(access.audience) &&
    claims.iss === `https://${access.team}.cloudflareaccess.com` &&
    claims.exp * 1000 > now
  );
}

export async function authenticate(request: IncomingMessage): Promise<User | undefined> {
  if (config.access && !(await verifyAccess(request.headers['cf-access-jwt-assertion'] as string | undefined, config.access))) {
    return undefined;
  }
  const login = config.dev?.login ?? unseal(cookies(request)[sessionCookie])?.login;
  return login ? current(login) : undefined;
}

export async function current(login: string, now = Date.now()): Promise<User | undefined> {
  if (config.dev) {
    return config.dev;
  }
  const member = members.get(login);
  if (!member) {
    return undefined;
  }
  if (now - member.checked > recheckMs) {
    const owner = await role(member.token);
    if (owner === undefined) {
      members.delete(login);
      return undefined;
    }
    Object.assign(member, { owner, checked: now });
  }
  return { login, owner: member.owner };
}

async function role(token: string) {
  const membership = await github<{ state: string; role: string }>(`/user/memberships/orgs/${config.organisation}`, token).catch(
    () => undefined,
  );
  return membership?.state === 'active' ? membership.role === 'admin' : undefined;
}

async function github<T>(path: string, token: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'project-graphite-console' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${path}`);
  }
  return (await response.json()) as T;
}

export function login(response: ServerResponse) {
  const state = randomBytes(16).toString('base64url');
  setCookie(response, stateCookie, state, 600);
  const query = new URLSearchParams({
    client_id: config.github!.clientId,
    redirect_uri: `${config.appUrl}/auth/callback`,
    scope: 'read:org',
    state,
  });
  response.writeHead(302, { Location: `https://github.com/login/oauth/authorize?${query}` }).end();
}

export async function callback(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (!url.searchParams.get('state') || url.searchParams.get('state') !== cookies(request)[stateCookie]) {
    response.writeHead(400).end('The sign-in expired; start again.');
    return;
  }
  const exchange = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.github!.clientId,
      client_secret: config.github!.clientSecret,
      code: url.searchParams.get('code'),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const { access_token: token } = (await exchange.json()) as { access_token?: string };
  if (!token) {
    response.writeHead(400).end('GitHub refused the sign-in; start again.');
    return;
  }
  const user = await github<{ login: string }>('/user', token);
  const owner = await role(token);
  if (owner === undefined) {
    response.writeHead(403).end(`${user.login} is not a member of ${config.organisation}.`);
    return;
  }
  members.set(user.login, { token, owner, checked: Date.now() });
  setCookie(response, stateCookie, '', 0);
  setCookie(response, sessionCookie, seal({ login: user.login, owner }), sessionHours * 3600);
  response.writeHead(302, { Location: '/' }).end();
}

export function logout(response: ServerResponse) {
  setCookie(response, sessionCookie, '', 0);
  response.writeHead(302, { Location: '/' }).end();
}

export function withoutSession(cookie: string | undefined) {
  return (cookie ?? '')
    .split(';')
    .filter((part) => !part.trim().startsWith('console_'))
    .join(';');
}
