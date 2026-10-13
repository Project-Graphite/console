import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Condition {
  key: string;
  title: string;
  detail: string;
}

export interface Alert extends Condition {
  id: number;
  since: number;
  resolved: number | null;
  issue: number | null;
}

const confirmAfter = 2;
const keepDays = 30;

export class Alerts {
  private readonly db: DatabaseSync;
  private readonly present = new Map<string, number>();
  private readonly absent = new Map<string, number>();

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'alerts.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY, key TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
        since INTEGER NOT NULL, resolved INTEGER, issue INTEGER
      );
      CREATE INDEX IF NOT EXISTS alerts_open ON alerts (key) WHERE resolved IS NULL;
    `);
  }

  active() {
    return this.db.prepare('SELECT * FROM alerts WHERE resolved IS NULL ORDER BY since').all() as unknown as Alert[];
  }

  recent(now = Date.now()) {
    return this.db
      .prepare('SELECT * FROM alerts WHERE resolved IS NOT NULL AND resolved > ? ORDER BY resolved DESC')
      .all(now - 7 * 86400_000) as unknown as Alert[];
  }

  update(conditions: Condition[], now = Date.now()) {
    const open = new Map(this.active().map((alert) => [alert.key, alert]));
    const seen = new Set(conditions.map((condition) => condition.key));
    const opened: Alert[] = [];
    const resolved: Alert[] = [];
    for (const condition of conditions) {
      this.absent.delete(condition.key);
      const streak = (this.present.get(condition.key) ?? 0) + 1;
      this.present.set(condition.key, streak);
      const alert = open.get(condition.key);
      if (alert) {
        this.db.prepare('UPDATE alerts SET title = ?, detail = ? WHERE id = ?').run(condition.title, condition.detail, alert.id);
      } else if (streak >= confirmAfter) {
        const { lastInsertRowid } = this.db
          .prepare('INSERT INTO alerts (key, title, detail, since) VALUES (?, ?, ?, ?)')
          .run(condition.key, condition.title, condition.detail, now);
        opened.push({ ...condition, id: Number(lastInsertRowid), since: now, resolved: null, issue: null });
      }
    }
    for (const alert of open.values()) {
      if (seen.has(alert.key)) {
        continue;
      }
      this.present.delete(alert.key);
      const streak = (this.absent.get(alert.key) ?? 0) + 1;
      this.absent.set(alert.key, streak);
      if (streak >= confirmAfter) {
        this.db.prepare('UPDATE alerts SET resolved = ? WHERE id = ?').run(now, alert.id);
        this.absent.delete(alert.key);
        resolved.push({ ...alert, resolved: now });
      }
    }
    for (const key of this.present.keys()) {
      if (!seen.has(key)) {
        this.present.delete(key);
      }
    }
    this.db.prepare('DELETE FROM alerts WHERE resolved IS NOT NULL AND resolved < ?').run(now - keepDays * 86400_000);
    return { opened, resolved };
  }

  linkIssue(id: number, issue: number) {
    this.db.prepare('UPDATE alerts SET issue = ? WHERE id = ?').run(issue, id);
  }

  close() {
    this.db.close();
  }
}
