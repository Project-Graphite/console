import { generateKeyPairSync, sign } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authenticate, callback, current, recheckMs, seal, unseal, verifyAccess, withoutSession } from '../src/server/auth.ts';
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

  it('never forwards console cookies to a proxied app', () => {
    expect(withoutSession('console_session=a; theme=dark; console_state=b')).toBe(' theme=dark');
  });
});

describe('organisation role', () => {
  const dev = config.dev;
  let membership: { status: number; role?: string };

  afterEach(() => {
    config.dev = dev;
    config.github = undefined;
    vi.unstubAllGlobals();
  });

  async function signIn() {
    config.dev = undefined;
    config.github = { clientId: 'id', clientSecret: 'secret' };
    vi.stubGlobal('fetch', async (url: string) => {
      const body = url.endsWith('/access_token')
        ? { access_token: 'token' }
        : url.endsWith('/user')
          ? { login: 'demoted' }
          : { state: 'active', role: membership.role };
      return new Response(JSON.stringify(body), { status: url.includes('/memberships/') ? membership.status : 200 });
    });
    const set: string[] = [];
    const response = { appendHeader: (_name: string, value: string) => set.push(value), writeHead: () => ({ end: () => undefined }) };
    await callback(
      { headers: { cookie: 'console_state=state' } } as IncomingMessage,
      response as unknown as ServerResponse,
      new URL('http://localhost:3000/auth/callback?state=state&code=code'),
    );
    const session = set.find((cookie) => cookie.startsWith('console_session='))!.split(';')[0];
    return authenticate({ headers: { cookie: session } } as IncomingMessage);
  }

  it('takes owner rights away once GitHub reports the demotion', async () => {
    membership = { status: 200, role: 'admin' };
    expect(await signIn()).toEqual({ login: 'demoted', owner: true });
    membership = { status: 200, role: 'member' };
    expect(await current('demoted')).toEqual({ login: 'demoted', owner: true });
    expect(await current('demoted', Date.now() + recheckMs + 1)).toEqual({ login: 'demoted', owner: false });
  });

  it('signs out someone removed from the organisation', async () => {
    membership = { status: 200, role: 'member' };
    await signIn();
    membership = { status: 404 };
    expect(await current('demoted', Date.now() + recheckMs + 1)).toBeUndefined();
    membership = { status: 200, role: 'member' };
    expect(await current('demoted', Date.now() + 2 * recheckMs)).toBeUndefined();
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
