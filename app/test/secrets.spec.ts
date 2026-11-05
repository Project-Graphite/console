import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { composeReferences, formatEnv, parseEnv, parseKeys, SecretStore } from '../src/server/secrets.ts';

const directories: string[] = [];
const stores: SecretStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const key = () => randomBytes(32).toString('base64');

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-secrets-'));
  directories.push(directory);
  return { data: path.join(directory, 'data'), host: path.join(directory, 'etc-graphite') };
}

function open(paths: { data: string; host: string }, keys: string) {
  const store = new SecretStore(paths.data, parseKeys(keys), paths.host);
  stores.push(store);
  return store;
}

function audit(paths: { data: string }) {
  const db = new DatabaseSync(path.join(paths.data, 'secrets.db'));
  const rows = db.prepare('SELECT login, action, project, name FROM secret_audit ORDER BY id').all();
  db.close();
  return rows;
}

describe('SecretStore', () => {
  it('stores values encrypted and returns them', () => {
    const paths = setup();
    const store = open(paths, key());
    store.create('strata', { name: 'SESSION_SECRET', description: 'signs sessions', value: '  s3cret value  ' }, 'amr');
    expect(store.value('strata', 'SESSION_SECRET')).toBe('s3cret value');
    const db = new DatabaseSync(path.join(paths.data, 'secrets.db'));
    const { ciphertext } = db.prepare('SELECT ciphertext FROM secret_versions').get() as { ciphertext: Uint8Array };
    db.close();
    expect(Buffer.from(ciphertext).includes('s3cret')).toBe(false);
    expect(store.list('strata')).toEqual([
      expect.objectContaining({ name: 'SESSION_SECRET', description: 'signs sessions', type: 'secure', version: 1, updatedBy: 'amr', value: null }),
    ]);
  });

  it('refuses a tampered value, or one moved to another name', () => {
    const paths = setup();
    const store = open(paths, key());
    store.create('strata', { name: 'A', value: 'one' }, 'amr');
    store.create('strata', { name: 'B', value: 'two' }, 'amr');
    const db = new DatabaseSync(path.join(paths.data, 'secrets.db'));
    const { ciphertext, nonce } = db.prepare("SELECT ciphertext, nonce FROM secret_versions WHERE name = 'A'").get() as { ciphertext: Uint8Array; nonce: Uint8Array };
    db.prepare("UPDATE secret_versions SET ciphertext = ?, nonce = ? WHERE name = 'B'").run(ciphertext, nonce);
    const flipped = Buffer.from(ciphertext);
    flipped[0] ^= 1;
    db.prepare("UPDATE secret_versions SET ciphertext = ? WHERE name = 'A'").run(flipped);
    db.close();
    expect(() => store.value('strata', 'A')).toThrow();
    expect(() => store.value('strata', 'B')).toThrow();
  });

  it('re-encrypts every version with the new key and refuses to start without the old one', () => {
    const paths = setup();
    const old = key();
    const next = key();
    const first = open(paths, old);
    first.create('strata', { name: 'TOKEN', value: 'v1' }, 'amr');
    first.update('strata', 'TOKEN', { value: 'v2' }, 'amr');
    first.close();
    stores.splice(0);
    expect(() => open(paths, next)).toThrow(/No key in SECRETS_KEY/);
    const rotated = open(paths, `${next},${old}`);
    expect(rotated.value('strata', 'TOKEN')).toBe('v2');
    rotated.close();
    stores.splice(0);
    const after = open(paths, next);
    expect(after.detail('strata', 'TOKEN').history.map((version) => version.length)).toEqual([2, 2]);
    expect(after.value('strata', 'TOKEN')).toBe('v2');
  });

  it('writes the project env file on every change, mode 600, without leaving a temporary file', () => {
    const paths = setup();
    const store = open(paths, key());
    store.create('strata', { name: 'B', value: 'with space' }, 'amr');
    store.create('strata', { name: 'A', value: 'plain-value' }, 'amr');
    const file = path.join(paths.host, 'strata.env');
    expect(readFileSync(file, 'utf8')).toBe("A=plain-value\nB='with space'\n");
    expect(readdirSync(paths.host)).toEqual(['strata.env']);
    store.remove('strata', ['A'], 'amr');
    expect(readFileSync(file, 'utf8')).toBe("B='with space'\n");
  });

  it('keeps versions and restores an old one as a new version', () => {
    const paths = setup();
    const store = open(paths, key());
    store.create('strata', { name: 'TOKEN', value: 'first' }, 'amr');
    store.update('strata', 'TOKEN', { value: 'second-longer' }, 'omar');
    store.update('strata', 'TOKEN', { description: 'only the description' }, 'omar');
    store.restore('strata', 'TOKEN', 1, 'amr');
    const detail = store.detail('strata', 'TOKEN');
    expect(detail.description).toBe('only the description');
    expect(detail.history.map(({ version, length, updatedBy }) => [version, length, updatedBy])).toEqual([
      [3, 5, 'amr'],
      [2, 13, 'omar'],
      [1, 5, 'amr'],
    ]);
    expect(store.value('strata', 'TOKEN')).toBe('first');
  });

  it('writes an audit row for every write and every reveal', () => {
    const paths = setup();
    const store = open(paths, key());
    store.create('strata', { name: 'TOKEN', value: 'one' }, 'amr');
    store.reveal('strata', 'TOKEN', 'omar');
    store.update('strata', 'TOKEN', { value: 'two' }, 'amr');
    store.restore('strata', 'TOKEN', 1, 'amr');
    store.importText('strata', 'OTHER=x', false, 'amr');
    store.remove('strata', ['TOKEN'], 'amr');
    store.audit('amr', 'redeploy', 'strata', null);
    expect(audit(paths).map((row) => `${row.login} ${row.action} ${row.name}`)).toEqual([
      'amr create TOKEN',
      'omar reveal TOKEN',
      'amr update TOKEN',
      'amr restore TOKEN',
      'amr create OTHER',
      'amr delete TOKEN',
      'amr redeploy null',
    ]);
  });

  it('reconciles a hand-edited env file into the store on start', () => {
    const paths = setup();
    const secret = key();
    const store = open(paths, secret);
    store.create('strata', { name: 'KEPT', value: 'same' }, 'amr');
    store.create('strata', { name: 'CHANGED', value: 'before' }, 'amr');
    store.create('strata', { name: 'REMOVED', value: 'gone' }, 'amr');
    store.create('pixelpocket', { name: 'LOST', value: 'restored' }, 'amr');
    store.close();
    stores.splice(0);
    writeFileSync(path.join(paths.host, 'strata.env'), 'KEPT=same\nCHANGED="after"\nADDED=new\n');
    writeFileSync(path.join(paths.host, 'agent.env'), 'CONSOLE_TOKEN=abc\n');
    writeFileSync(path.join(paths.host, 'console.env'), 'SECRETS_KEY=never-imported\n');
    rmSync(path.join(paths.host, 'pixelpocket.env'));
    const reopened = open(paths, secret);
    expect(reopened.list('strata').map((row) => [row.name, row.version])).toEqual([
      ['ADDED', 1],
      ['CHANGED', 2],
      ['KEPT', 1],
    ]);
    expect(reopened.value('strata', 'CHANGED')).toBe('after');
    expect(reopened.value('agent', 'CONSOLE_TOKEN')).toBe('abc');
    expect(reopened.projects()).toEqual(['agent', 'pixelpocket', 'strata']);
    expect(readFileSync(path.join(paths.host, 'pixelpocket.env'), 'utf8')).toBe('LOST=restored\n');
    expect(audit(paths).filter((row) => row.action === 'reconcile').map((row) => `${row.login} ${row.project}/${row.name}`)).toEqual([
      'host agent/CONSOLE_TOKEN',
      'host strata/CHANGED',
      'host strata/ADDED',
      'host strata/REMOVED',
    ]);
  });

  it('imports NAME=value lines in one step, after a preview, refusing names already there', () => {
    const paths = setup();
    const store = open(paths, key());
    const text = '# from SOPS\nexport A=1\nB="two words"\n';
    expect(store.importText('strata', text, true, 'amr')).toEqual(['A', 'B']);
    expect(store.list('strata')).toEqual([]);
    expect(store.importText('strata', text, false, 'amr')).toEqual(['A', 'B']);
    expect(store.value('strata', 'B')).toBe('two words');
    expect(() => store.importText('strata', 'B=again', false, 'amr')).toThrow('Already in /strata/: B.');
    expect(() => store.importText('strata', 'C=', false, 'amr')).toThrow('Empty values for C.');
  });

  it('refuses bad names, empty values, duplicates and the console project', () => {
    const paths = setup();
    const store = open(paths, key());
    expect(() => store.create('strata', { name: 'lower', value: 'x' }, 'amr')).toThrow(/capital letters/);
    expect(() => store.create('strata', { name: '1ST', value: 'x' }, 'amr')).toThrow(/capital letters/);
    expect(() => store.create('strata', { name: 'EMPTY', value: '   ' }, 'amr')).toThrow('The value cannot be empty.');
    expect(() => store.create('strata', { name: 'TYPED', type: 'other', value: 'x' }, 'amr')).toThrow('The type is secure or plain.');
    expect(() => store.create('console', { name: 'SECRETS_KEY', value: 'x' }, 'amr')).toThrow(/console\.env/);
    store.create('strata', { name: 'ONCE', value: 'x' }, 'amr');
    expect(() => store.create('strata', { name: 'ONCE', value: 'y' }, 'amr')).toThrow('/strata/ONCE already exists.');
    expect(() => store.update('strata', 'MISSING', { value: 'y' }, 'amr')).toThrow('There is no /strata/MISSING.');
    expect(existsSync(path.join(paths.host, 'console.env'))).toBe(false);
  });

  it('shows plain values in the list and hides secure ones', () => {
    const paths = setup();
    const store = open(paths, key());
    store.create('hub', { name: 'PUBLIC_KEY', type: 'plain', value: 'ssh-ed25519 AAAA' }, 'amr');
    store.create('hub', { name: 'PRIVATE_KEY', value: 'hidden' }, 'amr');
    expect(store.list().map((row) => [row.name, row.value])).toEqual([
      ['PRIVATE_KEY', null],
      ['PUBLIC_KEY', 'ssh-ed25519 AAAA'],
    ]);
  });
});

describe('env files', () => {
  it('round-trips values that need quoting', () => {
    const values: [string, string][] = [
      ['BARE', 'abc-123_./:+=@,%~'],
      ['SPACE', 'two words'],
      ['DOLLAR', 'pa$$word#1'],
      ['QUOTE', "it's \"here\""],
      ['PEM', '-----BEGIN KEY-----\nAAA\\nBBB\n-----END KEY-----'],
      ['ESCAPED', 'literal\\nnot-a-newline'],
    ];
    expect([...parseEnv(formatEnv(values))]).toEqual(values);
  });

  it('reads comments, blank lines, export and CRLF, and names a bad line', () => {
    expect([...parseEnv('# head\r\n\r\nexport A=1\r\nB = two \r\nC=\'x\' # note\r\n')]).toEqual([
      ['A', '1'],
      ['B', 'two'],
      ['C', 'x'],
    ]);
    expect(() => parseEnv('A=1\nnot a line\n')).toThrow('Line 2 is not NAME=value');
  });
});

describe('composeReferences', () => {
  it('finds every variable a compose file uses and which are required', () => {
    const references = composeReferences(
      ['services:', '  app:', '    image: app:${IMAGE_TAG}', '    environment:', '      A: ${A:?}', '      B: ${B:-}', '      C: ${A}-${C?missing}'].join('\n'),
    );
    expect(Object.fromEntries(references)).toEqual({
      IMAGE_TAG: { required: false, lines: [3] },
      A: { required: true, lines: [5, 7] },
      B: { required: false, lines: [6] },
      C: { required: true, lines: [7] },
    });
  });
});
