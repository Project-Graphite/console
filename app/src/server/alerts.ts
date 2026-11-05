import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Condition {
  key: string;
  title: string;
  detail: string;
  for?: number;
}

export interface Alert extends Omit<Condition, 'for'> {
  id: number;
  since: number;
  resolved: number | null;
  issue: number | null;
}

export const ruleKinds = {
  'host-cpu': { label: 'Host CPU above', unit: '%', threshold: 90, minutes: 5 },
  'host-memory': { label: 'Host memory above', unit: '%', threshold: 90, minutes: 2 },
  'host-swap': { label: 'Swap above', unit: '%', threshold: 80, minutes: 2 },
  'host-disk': { label: 'Disk above', unit: '%', threshold: 85, minutes: 2 },
  'container-cpu': { label: 'A container above its CPU limit by', unit: '%', threshold: 90, minutes: 5 },
  'container-memory': { label: 'A container above its memory limit by', unit: '%', threshold: 90, minutes: 2 },
  'container-down': { label: 'A container stopped', unit: null, threshold: 0, minutes: 1 },
  'container-unhealthy': { label: 'A container unhealthy', unit: null, threshold: 0, minutes: 1 },
  'container-restarts': { label: 'A container restarted in 10 minutes, times', unit: 'restarts', threshold: 3, minutes: 0 },
  'backup-late': { label: 'A project without a backup for', unit: 'hours', threshold: 26, minutes: 0 },
} as const;

export type RuleKind = keyof typeof ruleKinds;

export interface Rule {
  kind: RuleKind;
  threshold: number;
  minutes: number;
  enabled: boolean;
}

export const defaultRules = Object.fromEntries(
  Object.entries(ruleKinds).map(([kind, rule]) => [kind, { kind, threshold: rule.threshold, minutes: rule.minutes, enabled: true }]),
) as Record<RuleKind, Rule>;

const resolveAfter = 60_000;
const keepDays = 30;

export class Alerts {
  private readonly db: DatabaseSync;
  private readonly since = new Map<string, number>();
  private readonly clear = new Map<string, number>();

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'alerts.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY, key TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
        since INTEGER NOT NULL, resolved INTEGER, issue INTEGER
      );
      CREATE INDEX IF NOT EXISTS alerts_open ON alerts (key) WHERE resolved IS NULL;
      CREATE TABLE IF NOT EXISTS rules (kind TEXT PRIMARY KEY, threshold REAL NOT NULL, minutes REAL NOT NULL, enabled INTEGER NOT NULL);
    `);
  }

  rules(): Record<RuleKind, Rule> {
    const saved = this.db.prepare('SELECT kind, threshold, minutes, enabled FROM rules').all() as { kind: string; threshold: number; minutes: number; enabled: number }[];
    const rules = structuredClone(defaultRules);
    for (const row of saved.filter((entry) => entry.kind in ruleKinds)) {
      rules[row.kind as RuleKind] = { kind: row.kind as RuleKind, threshold: row.threshold, minutes: row.minutes, enabled: row.enabled === 1 };
    }
    return rules;
  }

  setRule(rule: Rule) {
    this.db
      .prepare('INSERT INTO rules (kind, threshold, minutes, enabled) VALUES (?, ?, ?, ?) ON CONFLICT (kind) DO UPDATE SET threshold = excluded.threshold, minutes = excluded.minutes, enabled = excluded.enabled')
      .run(rule.kind, rule.threshold, rule.minutes, rule.enabled ? 1 : 0);
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
      this.clear.delete(condition.key);
      const first = this.since.get(condition.key) ?? now;
      this.since.set(condition.key, first);
      const alert = open.get(condition.key);
      if (alert) {
        this.db.prepare('UPDATE alerts SET title = ?, detail = ? WHERE id = ?').run(condition.title, condition.detail, alert.id);
      } else if (now - first >= (condition.for ?? 0)) {
        const { lastInsertRowid } = this.db
          .prepare('INSERT INTO alerts (key, title, detail, since) VALUES (?, ?, ?, ?)')
          .run(condition.key, condition.title, condition.detail, first);
        opened.push({ key: condition.key, title: condition.title, detail: condition.detail, id: Number(lastInsertRowid), since: first, resolved: null, issue: null });
      }
    }
    for (const alert of open.values()) {
      if (seen.has(alert.key)) {
        continue;
      }
      const cleared = this.clear.get(alert.key) ?? now;
      this.clear.set(alert.key, cleared);
      if (now - cleared >= resolveAfter) {
        this.db.prepare('UPDATE alerts SET resolved = ? WHERE id = ?').run(now, alert.id);
        this.clear.delete(alert.key);
        resolved.push({ ...alert, resolved: now });
      }
    }
    for (const key of this.since.keys()) {
      if (!seen.has(key)) {
        this.since.delete(key);
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
