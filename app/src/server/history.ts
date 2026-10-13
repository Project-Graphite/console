import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const keep = 24 * 60 * 60 * 1000;

export interface Sample {
  target: string;
  cpu: number;
  memory: number;
}

export class History {
  private readonly db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'metrics.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (at INTEGER NOT NULL, target TEXT NOT NULL, cpu REAL NOT NULL, memory INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS samples_target_at ON samples (target, at);
    `);
  }

  record(at: number, samples: Sample[]) {
    const insert = this.db.prepare('INSERT INTO samples (at, target, cpu, memory) VALUES (?, ?, ?, ?)');
    for (const sample of samples) {
      insert.run(at, sample.target, sample.cpu, sample.memory);
    }
    this.db.prepare('DELETE FROM samples WHERE at < ?').run(at - keep);
  }

  series(target: string) {
    return this.db
      .prepare('SELECT at, cpu, memory FROM samples WHERE target = ? ORDER BY at')
      .all(target) as { at: number; cpu: number; memory: number }[];
  }

  close() {
    this.db.close();
  }
}
