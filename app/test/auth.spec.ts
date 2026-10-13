import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownsNow, seal, unseal, verifyAccess, withoutSession } from '../src/server/auth.ts';
import { config } from '../src/server/config.ts';

const access = { team: 'graphite', audience: 'console-aud' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = async () => [{ ...publicKey.export({ format: 'jwk' }), kid: 'key-1' }];

function token(claims: Record<string, unknown>, kid = 'key-1', key = privateKey) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'RS256', kid })}.${encode(claims)}`;
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

const valid = { aud: ['console-aud'], iss: 'https://graphite.cloudflareaccess.com', exp: Date.now() / 1000 + 60 };

describe('sessions', () => {
  it('round-trips a session', () => {
    expect(unseal(seal({ login: 'AmrMsCLL', owner: true }))).toEqual({ login: 'AmrMsCLL', owner: true });
  });

  it('refuses a tampered session', () => {
    const [value, signature] = seal({ login: 'someone', owner: false }).split('.');
    const forged = Buffer.from(JSON.stringify({ login: 'someone', owner: true, exp: Date.now() + 1e9 })).toString('base64url');
    expect(unseal(`${forged}.${signature}`)).toBeUndefined();
    expect(unseal(`${value}.x${signature}`)).toBeUndefined();
  });

  it('refuses an expired session', () => {
    expect(unseal(seal({ login: 'someone', owner: false }, 0))).toBeUndefined();
  });

  it('keeps the GitHub token unreadable inside the cookie', () => {
    const cookie = seal({ login: 'AmrMsCLL', owner: true, github: 'gho_secret_token' });
    for (const part of cookie.split('.')) {
      expect(Buffer.from(part, 'base64url').toString('latin1')).not.toContain('gho_secret_token');
    }
    expect(unseal(cookie)).toEqual({ login: 'AmrMsCLL', owner: true });
  });

  it('never forwards console cookies to a proxied app', () => {
    expect(withoutSession('console_session=a; theme=dark; console_state=b')).toBe(' theme=dark');
  });
});

describe('Cloudflare Access', () => {
  it('accepts a valid token', async () => {
    expect(await verifyAccess(token(valid), access, keys)).toBe(true);
  });

  it('refuses the wrong audience, issuer, expiry or key id', async () => {
    expect(await verifyAccess(token({ ...valid, aud: ['other'] }), access, keys)).toBe(false);
    expect(await verifyAccess(token({ ...valid, iss: 'https://evil.cloudflareaccess.com' }), access, keys)).toBe(false);
    expect(await verifyAccess(token({ ...valid, exp: 1 }), access, keys)).toBe(false);
    expect(await verifyAccess(token(valid, 'unknown'), access, keys)).toBe(false);
    expect(await verifyAccess(undefined, access, keys)).toBe(false);
  });

  it('refuses a token signed by another key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(await verifyAccess(token(valid, 'key-1', other.privateKey), access, keys)).toBe(false);
  });
});

describe('owner actions', () => {
  const dev = config.dev;
  let membership: { status: number; role?: string };

  afterEach(() => {
    config.dev = dev;
    vi.unstubAllGlobals();
  });

  function github() {
    config.dev = undefined;
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ state: 'active', role: membership.role }), { status: membership.status }));
  }

  it('asks GitHub whether the user is still an owner', async () => {
    github();
    const now = Date.now();
    membership = { status: 200, role: 'admin' };
    expect(await ownsNow('token-a', now)).toBe(true);
    membership = { status: 200, role: 'member' };
    expect(await ownsNow('token-a', now + 1000)).toBe(true);
    expect(await ownsNow('token-a', now + 61_000)).toBe(false);
  });

  it('refuses without a token or a membership', async () => {
    github();
    membership = { status: 404 };
    expect(await ownsNow('token-b')).toBe(false);
    expect(await ownsNow(undefined)).toBe(false);
  });
});
