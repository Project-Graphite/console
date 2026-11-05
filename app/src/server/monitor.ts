import type { Alert, Alerts, Condition } from './alerts.ts';
import { backupConditions } from './backups.ts';
import { config } from './config.ts';
import { docker } from './docker.ts';
import { snapshot, type ContainerView } from './inventory.ts';

interface Inspect {
  RestartCount: number;
  State: { OOMKilled: boolean };
}

type Host = Awaited<ReturnType<typeof snapshot>>['host'];

const restarts = new Map<string, { at: number; count: number }[]>();

export function completed(container: ContainerView) {
  return container.state === 'exited' && container.status.startsWith('Exited (0)') && !container.sleeps;
}

export function hostConditions(host: Host): Condition[] {
  const checks = [
    { key: 'memory', label: 'memory', usage: host.memory, limit: 0.9 },
    { key: 'swap', label: 'swap', usage: host.swap, limit: 0.8 },
    { key: 'disk', label: 'disk', usage: host.disk, limit: 0.85 },
  ];
  return checks
    .filter((check) => check.usage.total > 0 && check.usage.used / check.usage.total > check.limit)
    .map((check) => ({
      key: check.key,
      title: `The VPS ${check.label} is ${Math.round((100 * check.usage.used) / check.usage.total)}% used`,
      detail: `Over ${Math.round(check.limit * 100)}%: ${Math.round(check.usage.used / 1048576)} MB of ${Math.round(check.usage.total / 1048576)} MB.`,
    }));
}

export function containerConditions(views: ContainerView[], inspects: Map<string, Inspect>, now: number): Condition[] {
  const found: Condition[] = [];
  for (const container of views) {
    if (completed(container) || (container.sleeps && container.state !== 'running')) {
      continue;
    }
    const inspect = inspects.get(container.id);
    const oom = inspect?.State.OOMKilled ? ' It was killed for running out of memory.' : '';
    if (container.state !== 'running') {
      found.push({ key: `down:${container.name}`, title: `${container.name} is ${container.state}`, detail: `${container.status}.${oom}` });
    } else if (container.health === 'unhealthy') {
      found.push({ key: `unhealthy:${container.name}`, title: `${container.name} is unhealthy`, detail: `Its health check fails: ${container.status}.` });
    }
    if (inspect) {
      const history = [...(restarts.get(container.name) ?? []), { at: now, count: inspect.RestartCount }].filter((entry) => entry.at > now - 10 * 60_000);
      restarts.set(container.name, history);
      const recent = inspect.RestartCount - history[0].count;
      if (recent >= 3) {
        found.push({ key: `restarts:${container.name}`, title: `${container.name} keeps restarting`, detail: `${recent} restarts in the last 10 minutes.${oom}` });
      }
    }
  }
  return found;
}

async function conditions(now: number) {
  const { host, views } = await snapshot();
  const inspects = new Map(
    await Promise.all(
      views
        .filter((container) => container.state === 'running' || container.state === 'restarting')
        .map(async (container) => [container.id, await docker<Inspect>('GET', `/containers/${container.id}/json`)] as const),
    ),
  );
  return [...hostConditions(host), ...containerConditions(views, inspects, now), ...(await backupConditions(now))];
}

async function github(method: string, route: string, body: unknown) {
  const response = await fetch(`https://api.github.com/repos/${config.alertsRepo}${route}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.alertsToken}`,
      'User-Agent': 'project-graphite-console',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for ${route}`);
  }
  return (await response.json()) as { number: number };
}

async function notify(alerts: Alerts, resolved: Alert[]) {
  for (const alert of alerts.active().filter((candidate) => candidate.issue === null)) {
    const issue = await github('POST', '/issues', {
      title: `Alert: ${alert.title}`,
      labels: ['alert'],
      body: `${alert.detail}\n\nRaised by the console: ${config.appUrl}/#/alerts`,
    });
    alerts.linkIssue(alert.id, issue.number);
  }
  for (const alert of resolved.filter((candidate) => candidate.issue !== null)) {
    await github('POST', `/issues/${alert.issue}/comments`, { body: 'Resolved.' });
    await github('PATCH', `/issues/${alert.issue}`, { state: 'closed', state_reason: 'completed' });
  }
}

export function monitor(alerts: Alerts, every = 60_000) {
  const tick = async () => {
    const { resolved } = alerts.update(await conditions(Date.now()));
    if (config.alertsToken) {
      await notify(alerts, resolved);
    }
  };
  const timer = setInterval(() => void tick().catch((error: unknown) => console.error('alerts failed:', error)), every);
  return () => clearInterval(timer);
}
