import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Alerts, defaultRules } from '../src/server/alerts.ts';
import { backupConditions } from '../src/server/backups.ts';
import type { ContainerView } from '../src/server/inventory.ts';
import type { HostLive } from '../src/server/live.ts';
import { containerConditions, hostConditions, usageConditions } from '../src/server/monitor.ts';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporary() {
  const directory = mkdtempSync(path.join(tmpdir(), 'console-alerts-'));
  directories.push(directory);
  return directory;
}

function container(service: string, overrides: Partial<ContainerView> = {}): ContainerView {
  return {
    id: `id-${service}`,
    name: `strata-${service}-1`,
    project: 'strata',
    service,
    image: 'image',
    imageId: 'sha256:x',
    state: 'running',
    status: 'Up 2 hours',
    health: null,
    created: 0,
    ports: [],
    networks: {},
    sleeps: false,
    cpu: 1,
    memory: 1,
    memoryLimit: 100,
    ...overrides,
  };
}

const condition = { key: 'disk', title: 'The VPS disk is 90% used', detail: 'Over 85%.', for: 120_000 };

describe('Alerts', () => {
  it('opens an alert once its condition has held for the rule duration, and resolves it after a clear minute', () => {
    const alerts = new Alerts(temporary());
    expect(alerts.update([condition], 0).opened).toEqual([]);
    expect(alerts.update([condition], 110_000).opened).toEqual([]);
    expect(alerts.update([condition], 120_000).opened.map((alert) => [alert.key, alert.since])).toEqual([['disk', 0]]);
    expect(alerts.update([condition], 130_000).opened).toEqual([]);
    expect(alerts.update([], 140_000).resolved).toEqual([]);
    expect(alerts.update([], 190_000).resolved).toEqual([]);
    expect(alerts.active()).toHaveLength(1);
    expect(alerts.update([], 200_000).resolved.map((alert) => alert.resolved)).toEqual([200_000]);
    expect(alerts.active()).toEqual([]);
    expect(alerts.recent(210_000).map((alert) => alert.key)).toEqual(['disk']);
    alerts.close();
  });

  it('ignores a condition that clears before its duration, and keeps an alert that returns within the clear minute', () => {
    const alerts = new Alerts(temporary());
    alerts.update([condition], 0);
    alerts.update([], 60_000);
    expect(alerts.update([condition], 130_000).opened).toEqual([]);
    expect(alerts.update([condition], 250_000).opened).toHaveLength(1);
    alerts.update([], 260_000);
    alerts.update([condition], 290_000);
    expect(alerts.update([], 330_000).resolved).toEqual([]);
    expect(alerts.active()).toHaveLength(1);
    alerts.close();
  });

  it('keeps edited rules and falls back to the defaults', () => {
    const directory = temporary();
    const alerts = new Alerts(directory);
    expect(alerts.rules()['host-disk']).toEqual(defaultRules['host-disk']);
    alerts.setRule({ kind: 'host-disk', threshold: 70, minutes: 0.5, enabled: false });
    alerts.close();
    const reopened = new Alerts(directory);
    expect(reopened.rules()['host-disk']).toEqual({ kind: 'host-disk', threshold: 70, minutes: 0.5, enabled: false });
    expect(reopened.rules()['host-cpu']).toEqual(defaultRules['host-cpu']);
    reopened.close();
  });
});

describe('rules', () => {
  const usage = (used: number) => ({ used, total: 100 });

  it('flags host memory over 90%, swap over 80% and disk over 85%', () => {
    const host = { cpu: 0, cpus: 2, load: [], uptime: 0, memory: usage(91), swap: usage(50), disk: usage(86) };
    expect(hostConditions(host).map((found) => found.key)).toEqual(['memory', 'disk']);
  });

  it('follows edited thresholds, durations and switches', () => {
    const host = { cpu: 95, cpus: 2, memory: usage(91), swap: usage(50), disk: usage(86) };
    const rules = { ...defaultRules, 'host-cpu': { ...defaultRules['host-cpu'], minutes: 1 }, 'host-memory': { ...defaultRules['host-memory'], enabled: false }, 'host-swap': { ...defaultRules['host-swap'], threshold: 40 } };
    expect(hostConditions(host, rules).map((found) => [found.key, found.for])).toEqual([
      ['cpu', 60_000],
      ['swap', 120_000],
      ['disk', 120_000],
    ]);
  });

  it("measures a container's CPU and memory against its own limits", () => {
    const live = (cpu: number, cpuLimit: number | null, memory: number, memoryLimit: number | null) => ({ project: 'strata', cpu, cpuLimit, memory, memoryLimit, rx: 0, tx: 0, read: 0, write: 0 });
    const frame = {
      host: { cpus: 4 } as HostLive,
      containers: {
        'strata-app-1': live(70, 0.75, 95, 100),
        'strata-postgres-1': live(380, null, 10, null),
        'strata-redis-1': live(10, 0.25, 50, 100),
      },
    };
    expect(usageConditions(frame).map((found) => found.key)).toEqual(['cpu:strata-app-1', 'memory:strata-app-1', 'cpu:strata-postgres-1']);
  });

  it('flags stopped and unhealthy containers, but not finished jobs or sleeping projects', () => {
    const views = [
      container('app', { health: 'unhealthy', status: 'Up 1 hour (unhealthy)' }),
      container('worker', { state: 'exited', status: 'Exited (1) 2 minutes ago' }),
      container('minio-init', { state: 'exited', status: 'Exited (0) 3 hours ago' }),
      container('web', { state: 'exited', status: 'Exited (137) 1 hour ago', sleeps: true }),
    ];
    const inspects = new Map([['id-worker', { RestartCount: 0, State: { OOMKilled: true } }]]);
    const found = containerConditions(views, inspects, 0);
    expect(found.map((entry) => entry.key)).toEqual(['unhealthy:strata-app-1', 'down:strata-worker-1']);
    expect(found[1].detail).toContain('out of memory');
  });

  it('flags a container that restarted three times in ten minutes', () => {
    const views = [container('redis')];
    for (const [at, count] of [[0, 1], [60_000, 2], [120_000, 3]]) {
      expect(containerConditions(views, new Map([['id-redis', { RestartCount: count, State: { OOMKilled: false } }]]), at)).toEqual([]);
    }
    const found = containerConditions(views, new Map([['id-redis', { RestartCount: 4, State: { OOMKilled: false } }]]), 180_000);
    expect(found.map((entry) => entry.key)).toEqual(['restarts:strata-redis-1']);
  });

  it('flags a project whose newest backup is older than 26 hours or failed verification', async () => {
    const root = temporary();
    const folder = path.join(root, 'strata');
    mkdirSync(folder, { recursive: true });
    const now = Date.parse('2026-11-05T10:00:00Z');
    const summary = (stamp: string, fields: object = {}) =>
      writeFileSync(path.join(folder, `${stamp}.json`), JSON.stringify({ project: 'strata', stamp, started: '', ok: true, errors: [], items: [], ...fields }));
    summary('20261105T030000Z');
    expect(await backupConditions(now, root)).toEqual([]);
    summary('20261105T040000Z', { ok: false, errors: ['postgres postgres: its container is not running'] });
    expect((await backupConditions(now, root)).map((entry) => entry.detail)).toEqual(['postgres postgres: its container is not running']);
    expect((await backupConditions(now + 30 * 3600_000, root)).map((entry) => entry.key)).toEqual(['backup:strata']);
    summary('20261105T090000Z', { imported: true });
    expect((await backupConditions(now, root)).map((entry) => entry.title)).toEqual(["strata's last backup failed"]);
  });
});
