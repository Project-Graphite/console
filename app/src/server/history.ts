import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export const ranges = {
  '1h': { span: hour, step: minute },
  '5h': { span: 5 * hour, step: minute },
  '1d': { span: day, step: 5 * minute },
  '7d': { span: 7 * day, step: 30 * minute },
  '30d': { span: 30 * day, step: 2 * hour },
} as const;

export type Range = keyof typeof ranges;

export const keep = ranges['30d'].span;

export interface Sample {
  target: string;
  cpu: number;
  memory: number;
}

export interface Point {
  at: number;
  cpu: number;
  memory: number;
}

export function projectTotals(containers: { name: string; project: string }[], seriesOf: (name: string) => Point[], cpus: number) {
  const projects = new Map<string, Map<number, Point>>();
  for (const container of containers) {
    const totals = projects.get(container.project) ?? new Map<number, Point>();
    projects.set(container.project, totals);
    for (const point of seriesOf(container.name)) {
      const total = totals.get(point.at) ?? { at: point.at, cpu: 0, memory: 0 };
      total.cpu += point.cpu / cpus;
      total.memory += point.memory;
      totals.set(point.at, total);
    }
  }
  return [...projects]
    .filter(([, totals]) => totals.size > 0)
    .map(([name, totals]) => ({ name, points: [...totals.values()].sort((a, b) => a.at - b.at) }));
}

export class History {
  private readonly db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'metrics.db'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (at INTEGER NOT NULL, target TEXT NOT NULL, cpu REAL NOT NULL, memory INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS samples_target_at ON samples (target, at);
      CREATE INDEX IF NOT EXISTS samples_at ON samples (at);
    `);
  }

  record(at: number, samples: Sample[]) {
    const insert = this.db.prepare('INSERT INTO samples (at, target, cpu, memory) VALUES (?, ?, ?, ?)');
    for (const sample of samples) {
      insert.run(at, sample.target, sample.cpu, sample.memory);
    }
    this.db.prepare('DELETE FROM samples WHERE at < ?').run(at - keep);
  }

  series(target: string, range: Range = '1d', now = Date.now()) {
    const { span, step } = ranges[range];
    return this.db
      .prepare(
        `SELECT CAST(at / ? AS INTEGER) * ? AS at, avg(cpu) AS cpu, CAST(avg(memory) AS INTEGER) AS memory
         FROM samples WHERE target = ? AND at > ? GROUP BY 1 ORDER BY 1`,
      )
      .all(step, step, target, now - span) as unknown as Point[];
  }

  close() {
    this.db.close();
  }
}
