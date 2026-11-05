import { mkdirSync } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Demuxer, docker, LogLines, stream } from './docker.ts';
import { resumeAfter } from './terminal.ts';

export const levels = ['error', 'warning', 'info', 'debug'] as const;
export type Level = (typeof levels)[number];
const day = 86_400_000;
const longest = 8192;

export function levelOf(text: string): Level {
  const lower = text.toLowerCase();
  if (/\b(error|err|failed|failure|exception|fatal|panic|critical)\b/.test(lower)) return 'error';
  if (/\b(warn|warning|wrn|caution)\b/.test(lower)) return 'warning';
  if (/\b(debug|dbg|trace|verbose)\b/.test(lower)) return 'debug';
  return 'info';
}

export interface StoredLine {
  id: number;
  at: number;
  time: string;
  project: string;
  service: string;
  container: string;
  stream: 'stdout' | 'stderr';
  level: Level;
  text: string;
}

export interface LogQuery {
  projects?: string[];
  containers?: string[];
  streams?: string[];
  levels?: string[];
  text?: string;
  from?: number;
  to?: number;
  before?: number;
  after?: number;
  limit?: number;
}

interface Source {
  id: string;
  name: string;
  project: string;
  service: string;
}

export class LogStore {
  private readonly db: DatabaseSync;
  private readonly following = new Map<string, http.IncomingMessage | null>();
  private pending: (Omit<StoredLine, 'id' | 'level'> & { level: Level })[] = [];

  constructor(
    directory: string,
    private readonly keepDays = 7,
  ) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, 'logs.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS lines (
        id INTEGER PRIMARY KEY, at INTEGER NOT NULL, time TEXT NOT NULL, project TEXT NOT NULL, service TEXT NOT NULL,
        container TEXT NOT NULL, stream TEXT NOT NULL, level TEXT NOT NULL, text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS lines_at ON lines (at);
      CREATE INDEX IF NOT EXISTS lines_container_at ON lines (container, at);
      CREATE TABLE IF NOT EXISTS cursors (container TEXT PRIMARY KEY, time TEXT NOT NULL);
    `);
  }

  add(line: Omit<StoredLine, 'id' | 'level' | 'at'>) {
    this.pending.push({ ...line, at: Date.parse(line.time) || Date.now(), level: levelOf(line.text), text: line.text.slice(0, longest) });
  }

  flush() {
    if (!this.pending.length) {
      return;
    }
    const lines = this.pending;
    this.pending = [];
    const insert = this.db.prepare('INSERT INTO lines (at, time, project, service, container, stream, level, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const cursor = this.db.prepare('INSERT INTO cursors (container, time) VALUES (?, ?) ON CONFLICT (container) DO UPDATE SET time = excluded.time');
    this.db.exec('BEGIN');
    try {
      for (const line of lines) {
        insert.run(line.at, line.time, line.project, line.service, line.container, line.stream, line.level, line.text);
        cursor.run(line.container, line.time);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  prune(now = Date.now()) {
    this.db.prepare('DELETE FROM lines WHERE at < ?').run(now - this.keepDays * day);
  }

  cursor(container: string) {
    return (this.db.prepare('SELECT time FROM cursors WHERE container = ?').get(container) as { time: string } | undefined)?.time;
  }

  query(filter: LogQuery) {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    const within = (column: string, list?: string[]) => {
      if (list?.length) {
        clauses.push(`${column} IN (${list.map(() => '?').join(', ')})`);
        values.push(...list);
      }
    };
    within('project', filter.projects);
    within('container', filter.containers);
    within('stream', filter.streams);
    within('level', filter.levels);
    for (const [clause, value] of [
      ['at >= ?', filter.from],
      ['at <= ?', filter.to],
      ['id < ?', filter.before],
      ['id > ?', filter.after],
    ] as const) {
      if (value !== undefined) {
        clauses.push(clause);
        values.push(value);
      }
    }
    if (filter.text) {
      clauses.push("text LIKE ? ESCAPE '\\'");
      values.push(`%${filter.text.replace(/[\\%_]/g, '\\$&')}%`);
    }
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
    const order = filter.after !== undefined ? 'ASC' : 'DESC';
    const rows = this.db
      .prepare(`SELECT * FROM lines ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY id ${order} LIMIT ?`)
      .all(...values, limit + 1) as unknown as StoredLine[];
    const lines = rows.slice(0, limit);
    return { lines: order === 'ASC' ? lines.reverse() : lines, more: rows.length > limit };
  }

  stats() {
    const totals = this.db.prepare("SELECT count(*) AS lines, min(at) AS oldest, sum(level = 'error') AS errors FROM lines").get() as {
      lines: number;
      oldest: number | null;
      errors: number | null;
    };
    const { size } = this.db.prepare('SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()').get() as { size: number };
    return { lines: totals.lines, oldest: totals.oldest, errors: totals.errors ?? 0, bytes: size };
  }

  sources(now = Date.now()) {
    return this.db
      .prepare('SELECT project, service, container, max(at) AS last FROM lines WHERE at >= ? GROUP BY project, service, container ORDER BY project, service')
      .all(now - this.keepDays * day) as { project: string; service: string; container: string; last: number }[];
  }

  private async follow(source: Source) {
    const since = this.cursor(source.name);
    const query = `since=${since ? resumeAfter(since) : Math.floor((Date.now() - this.keepDays * day) / 1000)}`;
    const { Config } = await docker<{ Config: { Tty: boolean } }>('GET', `/containers/${source.id}/json`);
    const output = await stream('GET', `/containers/${source.id}/logs?stdout=1&stderr=1&timestamps=1&follow=1&${query}`);
    if (!this.following.has(source.id)) {
      output.destroy();
      return;
    }
    this.following.set(source.id, output);
    const demuxer = Config.Tty ? undefined : new Demuxer();
    const lines = new LogLines();
    output.on('data', (chunk: Buffer) => {
      const parsed = demuxer
        ? demuxer.push(chunk).flatMap((frame) => lines.push(frame.stream === 2 ? 'stderr' : 'stdout', frame.data))
        : lines.push('stdout', chunk);
      for (const line of parsed) {
        this.add({ time: line.time, project: source.project, service: source.service, container: source.name, stream: line.stream, text: line.text });
      }
    });
    output.on('close', () => this.following.delete(source.id));
  }

  track(views: { id: string; name: string; project: string; service: string; state: string }[]) {
    const running = new Set(views.filter((view) => view.state === 'running').map((view) => view.id));
    for (const [id, output] of this.following) {
      if (!running.has(id)) {
        output?.destroy();
        this.following.delete(id);
      }
    }
    for (const view of views.filter((candidate) => running.has(candidate.id) && !this.following.has(candidate.id))) {
      this.following.set(view.id, null);
      this.follow(view).catch((error: unknown) => {
        this.following.delete(view.id);
        console.error(`following the logs of ${view.name} failed:`, error);
      });
    }
  }

  start(list: () => Promise<{ id: string; name: string; project: string; service: string; state: string }[]>) {
    const report = (task: string) => (error: unknown) => console.error(`${task} failed:`, error);
    const timers = [
      setInterval(() => void list().then((views) => this.track(views), report('log sources')), 5000),
      setInterval(() => {
        try {
          this.flush();
        } catch (error) {
          report('storing logs')(error);
        }
      }, 1000),
      setInterval(() => this.prune(), 3600_000),
    ];
    void list().then((views) => this.track(views), report('log sources'));
    this.prune();
    return () => timers.forEach(clearInterval);
  }

  close() {
    this.flush();
    this.db.close();
  }
}
