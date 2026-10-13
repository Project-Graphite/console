import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Alerts } from '../src/server/alerts.ts';
import type { ContainerView } from '../src/server/inventory.ts';
import { backupConditions, containerConditions, hostConditions } from '../src/server/monitor.ts';

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
    memoryLimit: 1,
    ...overrides,
  };
}

const condition = { key: 'disk', title: 'The VPS disk is 90% used', detail: 'Over 85%.' };

describe('Alerts', () => {
  it('opens an alert only after two checks in a row, and resolves it after two clear checks', () => {
    const alerts = new Alerts(temporary());
    expect(alerts.update([condition], 1).opened).toEqual([]);
    expect(alerts.update([condition], 2).opened.map((alert) => alert.key)).toEqual(['disk']);
    expect(alerts.update([condition], 3).opened).toEqual([]);
    expect(alerts.update([], 4).resolved).toEqual([]);
    expect(alerts.active()).toHaveLength(1);
    expect(alerts.update([], 5).resolved.map((alert) => alert.resolved)).toEqual([5]);
    expect(alerts.active()).toEqual([]);
    expect(alerts.recent(6).map((alert) => alert.key)).toEqual(['disk']);
    alerts.close();
  });

  it('ignores a condition that clears before it is confirmed', () => {
    const alerts = new Alerts(temporary());
    alerts.update([condition], 1);
    alerts.update([], 2);
    expect(alerts.update([condition], 3).opened).toEqual([]);
    alerts.close();
  });
});

describe('rules', () => {
  const usage = (used: number) => ({ used, total: 100 });

  it('flags host memory over 90%, swap over 80% and disk over 85%', () => {
    const host = { cpu: 0, cpus: 2, load: [], uptime: 0, memory: usage(91), swap: usage(50), disk: usage(86) };
    expect(hostConditions(host).map((found) => found.key)).toEqual(['memory', 'disk']);
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

  it('flags a backup older than 26 hours, or none after the first hour', async () => {
    const root = temporary();
    const folder = path.join(root, 'var/lib/docker/volumes/strata_backups/_data');
    mkdirSync(folder, { recursive: true });
    const now = Date.now();
    const backup = [container('backup', { created: now - 2 * 3600_000 })];
    expect((await backupConditions(backup, now, root)).map((entry) => entry.detail)).toEqual(['There is no dump in its backups volume.']);
    const dump = path.join(folder, 'strata-1.dump');
    writeFileSync(dump, '');
    utimesSync(dump, new Date(now - 3600_000), new Date(now - 3600_000));
    expect(await backupConditions(backup, now, root)).toEqual([]);
    utimesSync(dump, new Date(now - 30 * 3600_000), new Date(now - 30 * 3600_000));
    expect((await backupConditions(backup, now, root)).map((entry) => entry.key)).toEqual(['backup:strata']);
  });
});
