import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const scopePattern = /^(\*|area:(images|shell)|project:[a-z0-9-]+)$/;

export function permits(scopes: string[], scope: string) {
  return scopes.includes('*') || scopes.includes(scope);
}

export class Access {
  private readonly db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'access.db'));
    this.db.exec("CREATE TABLE IF NOT EXISTS members (login TEXT PRIMARY KEY, scopes TEXT NOT NULL DEFAULT '[]', seen INTEGER)");
  }

  scopes(login: string): string[] {
    const row = this.db.prepare('SELECT scopes FROM members WHERE login = ?').get(login.toLowerCase()) as { scopes: string } | undefined;
    return row ? (JSON.parse(row.scopes) as string[]) : [];
  }

  grant(login: string, scopes: string[]) {
    this.db
      .prepare('INSERT INTO members (login, scopes) VALUES (?, ?) ON CONFLICT (login) DO UPDATE SET scopes = excluded.scopes')
      .run(login.toLowerCase(), JSON.stringify([...new Set(scopes)].sort()));
  }

  seen(login: string, at = Date.now()) {
    this.db.prepare('INSERT INTO members (login, seen) VALUES (?, ?) ON CONFLICT (login) DO UPDATE SET seen = excluded.seen').run(login.toLowerCase(), at);
  }

  all() {
    return (this.db.prepare('SELECT login, scopes, seen FROM members ORDER BY login').all() as { login: string; scopes: string; seen: number | null }[]).map(
      (row) => ({ login: row.login, scopes: JSON.parse(row.scopes) as string[], seen: row.seen }),
    );
  }

  close() {
    this.db.close();
  }
}
