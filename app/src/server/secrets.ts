import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Refusal } from './refusal.ts';

export const projectPattern = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const namePattern = /^[A-Z_][A-Z0-9_]*$/;
const types = ['secure', 'plain'] as const;
export type SecretType = (typeof types)[number];

export interface Key {
  id: string;
  key: Buffer;
}

interface Row {
  project: string;
  name: string;
  description: string;
  type: SecretType;
  version: number;
  updated_by: string;
  updated_at: number;
}

interface Version {
  project: string;
  name: string;
  version: number;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  key_id: string;
  updated_by: string;
  updated_at: number;
}

export function parseKeys(value: string): Key[] {
  return value.split(',').map((entry) => {
    const key = Buffer.from(entry.trim(), 'base64');
    if (key.length !== 32) {
      throw new Error('SECRETS_KEY holds one or two base64 keys of 32 bytes, the new one first.');
    }
    return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
  });
}

function seal(key: Key, project: string, name: string, value: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key.key, nonce).setAAD(Buffer.from(`${project}/${name}`));
  return { ciphertext: Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]), nonce, key_id: key.id };
}

function quote(value: string) {
  if (/^[\w.:/+=@,%~-]*$/.test(value)) {
    return value;
  }
  if (!/['\r\n]/.test(value)) {
    return `'${value}'`;
  }
  return `"${value.replace(/[\\"$]/g, '\\$&').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}"`;
}

export function formatEnv(entries: Iterable<[string, string]>) {
  return [...entries].map(([name, value]) => `${name}=${quote(value)}\n`).join('');
}

const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t' };

export function parseEnv(text: string) {
  const blank = /[ \t]*(?:#[^\n]*)?(?:\r?\n|$)/y;
  const entry =
    /[ \t]*(?:export[ \t]+)?([A-Z_][A-Z0-9_]*)[ \t]*=[ \t]*(?:'([^']*)'[ \t]*(?:#[^\n]*)?|"((?:[^"\\]|\\[\s\S])*)"[ \t]*(?:#[^\n]*)?|([^\r\n]*))(?:\r?\n|$)/y;
  const entries = new Map<string, string>();
  let at = 0;
  while (at < text.length) {
    blank.lastIndex = at;
    entry.lastIndex = at;
    if (blank.test(text)) {
      at = blank.lastIndex;
      continue;
    }
    const match = entry.exec(text);
    if (!match) {
      throw new Refusal(400, `Line ${text.slice(0, at).split('\n').length} is not NAME=value with a capitalised name.`);
    }
    entries.set(
      match[1],
      match[2] ?? (match[3] === undefined ? match[4].trimEnd() : match[3].replace(/\\([\s\S])/g, (_, character: string) => escapes[character] ?? character)),
    );
    at = entry.lastIndex;
  }
  return entries;
}

function same(a: Map<string, string>, b: Map<string, string>) {
  return a.size === b.size && [...a].every(([name, value]) => b.get(name) === value);
}

function secretFields(input: unknown) {
  const { name, description = '', type = 'secure', value } = (input ?? {}) as Record<string, unknown>;
  if (typeof description !== 'string' || description.length > 500) {
    throw new Refusal(400, 'The description is text of at most 500 characters.');
  }
  if (!types.includes(type as SecretType)) {
    throw new Refusal(400, 'The type is secure or plain.');
  }
  return { name, description, type: type as SecretType, value };
}

function secretValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Refusal(400, 'The value cannot be empty.');
  }
  return value.trim();
}

export function composeReferences(text: string) {
  const references = new Map<string, { required: boolean; lines: number[] }>();
  text.split('\n').forEach((line, index) => {
    for (const [, name, required] of line.matchAll(/\$\{([A-Za-z_]\w*)(:?\?)?/g)) {
      const reference = references.get(name) ?? { required: false, lines: [] };
      reference.required ||= required !== undefined;
      reference.lines.push(index + 1);
      references.set(name, reference);
    }
  });
  return references;
}

export class SecretStore {
  private readonly db: DatabaseSync;

  constructor(
    directory: string,
    private readonly keys: Key[],
    private readonly hostDirectory: string,
  ) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'secrets.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (project TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL, version INTEGER NOT NULL,
        updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (project, name));
      CREATE TABLE IF NOT EXISTS secret_versions (project TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, ciphertext BLOB NOT NULL, nonce BLOB NOT NULL,
        key_id TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (project, name, version));
      CREATE TABLE IF NOT EXISTS secret_audit (id INTEGER PRIMARY KEY, login TEXT NOT NULL, action TEXT NOT NULL, project TEXT NOT NULL, name TEXT, at INTEGER NOT NULL);
    `);
    try {
      this.rotate();
      this.reconcile();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction(work: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private change(project: string, work: () => void) {
    this.transaction(() => {
      work();
      this.writeHost(project);
    });
  }

  private open(row: Version) {
    const key = this.keys.find((candidate) => candidate.id === row.key_id);
    if (!key) {
      throw new Error(`No key in SECRETS_KEY has id ${row.key_id}, which encrypted /${row.project}/${row.name}.`);
    }
    const data = Buffer.from(row.ciphertext);
    const decipher = createDecipheriv('aes-256-gcm', key.key, row.nonce).setAAD(Buffer.from(`${row.project}/${row.name}`));
    decipher.setAuthTag(data.subarray(-16));
    return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
  }

  private rotate() {
    const [current] = this.keys;
    const stale = this.db.prepare('SELECT * FROM secret_versions WHERE key_id <> ?').all(current.id) as unknown as Version[];
    this.transaction(() => {
      for (const row of stale) {
        const sealed = seal(current, row.project, row.name, this.open(row));
        this.db
          .prepare('UPDATE secret_versions SET ciphertext = ?, nonce = ?, key_id = ? WHERE project = ? AND name = ? AND version = ?')
          .run(sealed.ciphertext, sealed.nonce, sealed.key_id, row.project, row.name, row.version);
      }
    });
    if (stale.length) {
      console.log(`Re-encrypted ${stale.length} secret versions with key ${current.id}.`);
    }
  }

  private reconcile(at = Date.now()) {
    mkdirSync(this.hostDirectory, { recursive: true, mode: 0o700 });
    const files = new Set(
      readdirSync(this.hostDirectory).flatMap((file) => {
        const project = file.endsWith('.env') ? file.slice(0, -4) : '';
        return projectPattern.test(project) && project !== 'console' ? [project] : [];
      }),
    );
    for (const project of new Set([...files, ...this.projects()])) {
      this.change(project, () => {
        if (!files.has(project)) {
          return;
        }
        const onHost = parseEnv(readFileSync(path.join(this.hostDirectory, `${project}.env`), 'utf8'));
        const stored = this.entries(project);
        for (const [name, value] of onHost) {
          if (stored.get(name) === value) {
            continue;
          }
          if (stored.has(name)) {
            this.addVersion(project, name, value, 'host', at);
          } else {
            this.insert(project, name, '', 'secure', value, 'host', at);
          }
          this.audit('host', 'reconcile', project, name, at);
        }
        for (const name of stored.keys()) {
          if (!onHost.has(name)) {
            this.delete(project, name);
            this.audit('host', 'reconcile', project, name, at);
          }
        }
      });
    }
  }

  private writeHost(project: string) {
    const file = path.join(this.hostDirectory, `${project}.env`);
    const entries = this.entries(project);
    if (existsSync(file) && same(parseEnv(readFileSync(file, 'utf8')), entries)) {
      return;
    }
    mkdirSync(this.hostDirectory, { recursive: true, mode: 0o700 });
    writeFileSync(`${file}.new`, formatEnv(entries), { mode: 0o600 });
    renameSync(`${file}.new`, file);
  }

  private checkProject(project: string) {
    if (project === 'console') {
      throw new Refusal(400, "The console's own secrets live in /etc/graphite/console.env, placed by hand.");
    }
    if (!projectPattern.test(project)) {
      throw new Refusal(400, `${project} is not a project name.`);
    }
  }

  private exists(project: string, name: string) {
    return this.db.prepare('SELECT 1 FROM secrets WHERE project = ? AND name = ?').get(project, name) !== undefined;
  }

  private current(project: string, name: string) {
    const row = this.db.prepare('SELECT * FROM secrets WHERE project = ? AND name = ?').get(project, name) as Row | undefined;
    if (!row) {
      throw new Refusal(404, `There is no /${project}/${name}.`);
    }
    return row;
  }

  private versionOf(project: string, name: string, version: number) {
    const row = this.db.prepare('SELECT * FROM secret_versions WHERE project = ? AND name = ? AND version = ?').get(project, name, version) as Version | undefined;
    if (!row) {
      throw new Refusal(404, `/${project}/${name} has no version ${version}.`);
    }
    return this.open(row);
  }

  private entries(project: string) {
    const rows = this.db
      .prepare('SELECT v.* FROM secrets s JOIN secret_versions v ON v.project = s.project AND v.name = s.name AND v.version = s.version WHERE s.project = ? ORDER BY s.name')
      .all(project) as unknown as Version[];
    return new Map(rows.map((row) => [row.name, this.open(row)]));
  }

  private insert(project: string, name: string, description: string, type: SecretType, value: string, login: string, at: number) {
    this.db
      .prepare('INSERT INTO secrets (project, name, description, type, version, updated_by, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(project, name, description, type, login, at);
    this.addVersion(project, name, value, login, at);
  }

  private addVersion(project: string, name: string, value: string, login: string, at: number) {
    const { version } = this.db
      .prepare('UPDATE secrets SET version = version + 1, updated_by = ?, updated_at = ? WHERE project = ? AND name = ? RETURNING version')
      .get(login, at, project, name) as { version: number };
    const sealed = seal(this.keys[0], project, name, value);
    this.db
      .prepare('INSERT INTO secret_versions (project, name, version, ciphertext, nonce, key_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(project, name, version, sealed.ciphertext, sealed.nonce, sealed.key_id, login, at);
  }

  private delete(project: string, name: string) {
    this.db.prepare('DELETE FROM secrets WHERE project = ? AND name = ?').run(project, name);
    this.db.prepare('DELETE FROM secret_versions WHERE project = ? AND name = ?').run(project, name);
  }

  private describe(row: Row) {
    return {
      project: row.project,
      name: row.name,
      description: row.description,
      type: row.type,
      version: row.version,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      value: row.type === 'plain' ? this.value(row.project, row.name) : null,
    };
  }

  audit(login: string, action: string, project: string, name: string | null, at = Date.now()) {
    this.db.prepare('INSERT INTO secret_audit (login, action, project, name, at) VALUES (?, ?, ?, ?, ?)').run(login, action, project, name, at);
  }

  projects() {
    return (this.db.prepare('SELECT DISTINCT project FROM secrets ORDER BY project').all() as { project: string }[]).map((row) => row.project);
  }

  list(project?: string) {
    return (this.db.prepare('SELECT * FROM secrets WHERE $project IS NULL OR project = $project ORDER BY project, name').all({ project: project ?? null }) as unknown as Row[]).map(
      (row) => this.describe(row),
    );
  }

  value(project: string, name: string) {
    return this.versionOf(project, name, this.current(project, name).version);
  }

  detail(project: string, name: string) {
    const versions = this.db.prepare('SELECT * FROM secret_versions WHERE project = ? AND name = ? ORDER BY version DESC').all(project, name) as unknown as Version[];
    return {
      ...this.describe(this.current(project, name)),
      history: versions.map((row) => ({ version: row.version, length: this.open(row).length, updatedBy: row.updated_by, updatedAt: row.updated_at })),
    };
  }

  changedAt(project: string) {
    return statSync(path.join(this.hostDirectory, `${project}.env`), { throwIfNoEntry: false })?.mtimeMs ?? null;
  }

  reveal(project: string, name: string, login: string, at = Date.now()) {
    const value = this.value(project, name);
    this.audit(login, 'reveal', project, name, at);
    return value;
  }

  create(project: string, input: unknown, login: string, at = Date.now()) {
    this.checkProject(project);
    const { name, description, type, value } = secretFields(input);
    if (typeof name !== 'string' || !namePattern.test(name)) {
      throw new Refusal(400, 'A name is capital letters, digits and underscores, and does not start with a digit.');
    }
    if (this.exists(project, name)) {
      throw new Refusal(409, `/${project}/${name} already exists.`);
    }
    const text = secretValue(value);
    this.change(project, () => {
      this.insert(project, name, description, type, text, login, at);
      this.audit(login, 'create', project, name, at);
    });
  }

  importText(project: string, text: string, preview: boolean, login: string, at = Date.now()) {
    this.checkProject(project);
    const entries = parseEnv(text);
    if (!entries.size) {
      throw new Refusal(400, 'There is no NAME=value line to import.');
    }
    const taken = [...entries.keys()].filter((name) => this.exists(project, name));
    if (taken.length) {
      throw new Refusal(409, `Already in /${project}/: ${taken.join(', ')}.`);
    }
    const empty = [...entries].filter(([, value]) => !value.trim()).map(([name]) => name);
    if (empty.length) {
      throw new Refusal(400, `Empty values for ${empty.join(', ')}.`);
    }
    if (!preview) {
      this.change(project, () => {
        for (const [name, value] of entries) {
          this.insert(project, name, '', 'secure', value, login, at);
          this.audit(login, 'create', project, name, at);
        }
      });
    }
    return [...entries.keys()];
  }

  update(project: string, name: string, input: unknown, login: string, at = Date.now()) {
    this.current(project, name);
    const { description, type, value } = secretFields(input);
    const text = value === undefined ? undefined : secretValue(value);
    this.change(project, () => {
      this.db
        .prepare('UPDATE secrets SET description = ?, type = ?, updated_by = ?, updated_at = ? WHERE project = ? AND name = ?')
        .run(description, type, login, at, project, name);
      if (text !== undefined && text !== this.value(project, name)) {
        this.addVersion(project, name, text, login, at);
      }
      this.audit(login, 'update', project, name, at);
    });
  }

  restore(project: string, name: string, version: number, login: string, at = Date.now()) {
    const value = this.versionOf(project, name, version);
    this.change(project, () => {
      this.addVersion(project, name, value, login, at);
      this.audit(login, 'restore', project, name, at);
    });
  }

  remove(project: string, names: string[], login: string, at = Date.now()) {
    for (const name of names) {
      this.current(project, name);
    }
    this.change(project, () => {
      for (const name of names) {
        this.delete(project, name);
        this.audit(login, 'delete', project, name, at);
      }
    });
  }

  close() {
    this.db.close();
  }
}
