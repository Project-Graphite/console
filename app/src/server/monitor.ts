import nodemailer from 'nodemailer';
import { defaultRules, type Alert, type Alerts, type Condition, type Rule, type RuleKind } from './alerts.ts';
import { backupConditions } from './backups.ts';
import { config } from './config.ts';
import { docker } from './docker.ts';
import { checkHub, hubRunning } from './hub.ts';
import { snapshot, type ContainerView } from './inventory.ts';
import { latest, type Frame, type HostLive } from './live.ts';
import { Refusal } from './refusal.ts';

interface Inspect {
  RestartCount: number;
  State: { OOMKilled: boolean };
}

type Rules = Record<RuleKind, Rule>;

const restarts = new Map<string, { at: number; count: number }[]>();
const mailer = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : undefined;

const duration = (rule: Rule) => rule.minutes * 60_000;
const ratio = (usage: { used: number; total: number }) => (usage.total > 0 ? (100 * usage.used) / usage.total : 0);
const megabytes = (value: number) => `${Math.round(value / 1048576)} MB`;

export function completed(container: ContainerView) {
  return container.state === 'exited' && container.status.startsWith('Exited (0)') && !container.sleeps;
}

export function hostConditions(host: Pick<HostLive, 'cpu' | 'cpus' | 'memory' | 'swap' | 'disk'>, rules: Rules = defaultRules): Condition[] {
  const checks = [
    { kind: 'host-cpu', key: 'cpu', label: 'CPU', percent: host.cpu, detail: `across ${host.cpus} cores.` },
    { kind: 'host-memory', key: 'memory', label: 'memory', percent: ratio(host.memory), detail: `${megabytes(host.memory.used)} of ${megabytes(host.memory.total)}.` },
    { kind: 'host-swap', key: 'swap', label: 'swap', percent: ratio(host.swap), detail: `${megabytes(host.swap.used)} of ${megabytes(host.swap.total)}.` },
    { kind: 'host-disk', key: 'disk', label: 'disk', percent: ratio(host.disk), detail: `${megabytes(host.disk.used)} of ${megabytes(host.disk.total)}.` },
  ] as const;
  return checks
    .filter((check) => rules[check.kind].enabled && check.percent > rules[check.kind].threshold)
    .map((check) => ({
      key: check.key,
      title: `The VPS ${check.label} is ${Math.round(check.percent)}% used`,
      detail: `Over ${rules[check.kind].threshold}%: ${check.detail}`,
      for: duration(rules[check.kind]),
    }));
}

export function containerConditions(views: ContainerView[], inspects: Map<string, Inspect>, now: number, rules: Rules = defaultRules): Condition[] {
  const found: Condition[] = [];
  for (const container of views) {
    if (completed(container) || (container.sleeps && container.state !== 'running')) {
      continue;
    }
    const inspect = inspects.get(container.id);
    const oom = inspect?.State.OOMKilled ? ' It was killed for running out of memory.' : '';
    if (container.state !== 'running' && rules['container-down'].enabled) {
      found.push({ key: `down:${container.name}`, title: `${container.name} is ${container.state}`, detail: `${container.status}.${oom}`, for: duration(rules['container-down']) });
    } else if (container.health === 'unhealthy' && rules['container-unhealthy'].enabled) {
      found.push({
        key: `unhealthy:${container.name}`,
        title: `${container.name} is unhealthy`,
        detail: `Its health check fails: ${container.status}.`,
        for: duration(rules['container-unhealthy']),
      });
    }
    if (inspect) {
      const history = [...(restarts.get(container.name) ?? []), { at: now, count: inspect.RestartCount }].filter((entry) => entry.at > now - 10 * 60_000);
      restarts.set(container.name, history);
      const recent = inspect.RestartCount - history[0].count;
      if (rules['container-restarts'].enabled && recent >= rules['container-restarts'].threshold) {
        found.push({ key: `restarts:${container.name}`, title: `${container.name} keeps restarting`, detail: `${recent} restarts in the last 10 minutes.${oom}` });
      }
    }
  }
  return found;
}

export function usageConditions(frame: Pick<Frame, 'host' | 'containers'>, rules: Rules = defaultRules): Condition[] {
  return Object.entries(frame.containers).flatMap(([name, container]) => {
    const cores = container.cpuLimit ?? frame.host.cpus;
    const cpu = container.cpu / cores;
    const memory = container.memoryLimit ? (100 * container.memory) / container.memoryLimit : 0;
    return [
      ...(rules['container-cpu'].enabled && cpu > rules['container-cpu'].threshold
        ? [{ key: `cpu:${name}`, title: `${name} uses ${Math.round(cpu)}% of its CPU`, detail: `Over ${rules['container-cpu'].threshold}% of ${cores} cores.`, for: duration(rules['container-cpu']) }]
        : []),
      ...(rules['container-memory'].enabled && memory > rules['container-memory'].threshold
        ? [
            {
              key: `memory:${name}`,
              title: `${name} uses ${Math.round(memory)}% of its memory`,
              detail: `${megabytes(container.memory)} of its ${megabytes(container.memoryLimit!)} limit.`,
              for: duration(rules['container-memory']),
            },
          ]
        : []),
    ];
  });
}

async function conditions(rules: Rules, now: number) {
  const [{ host, views }, frame] = await Promise.all([snapshot(), latest()]);
  const inspects = new Map(
    await Promise.all(
      views
        .filter((container) => container.state === 'running' || container.state === 'restarting')
        .map(async (container) => [container.id, await docker<Inspect>('GET', `/containers/${container.id}/json`)] as const),
    ),
  );
  return [
    ...hostConditions(host, rules),
    ...containerConditions(views, inspects, now, rules),
    ...usageConditions(frame, rules),
    ...(rules['backup-late'].enabled ? await backupConditions(now, undefined, rules['backup-late'].threshold) : []),
    ...(hubRunning(views) ? await checkHub(rules) : []),
  ];
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

async function issues(alerts: Alerts, resolved: Alert[]) {
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

export const emailing = () => Boolean(mailer && config.alertsEmail);

export async function email(subject: string, text: string) {
  if (!mailer || !config.alertsEmail) {
    throw new Refusal(503, 'Email needs SMTP_URL and ALERTS_EMAIL in the console env file.');
  }
  await mailer.sendMail({ from: config.alertsFrom ?? config.alertsEmail, to: config.alertsEmail, subject, text });
}

async function emails(opened: Alert[], resolved: Alert[]) {
  for (const alert of opened) {
    await email(`Alert: ${alert.title}`, `${alert.detail}\n\nSince ${new Date(alert.since).toISOString()}.\n${config.appUrl}/#/alerts`);
  }
  for (const alert of resolved) {
    await email(`Resolved: ${alert.title}`, `Resolved at ${new Date(alert.resolved!).toISOString()} after starting ${new Date(alert.since).toISOString()}.\n${config.appUrl}/#/alerts`);
  }
}

export function monitor(alerts: Alerts, every = 10_000) {
  const tick = async () => {
    const now = Date.now();
    const { opened, resolved } = alerts.update(await conditions(alerts.rules(), now), now);
    const sent = await Promise.allSettled([
      ...(config.alertsToken ? [issues(alerts, resolved)] : []),
      ...(emailing() && (opened.length || resolved.length) ? [emails(opened, resolved)] : []),
    ]);
    for (const result of sent) {
      if (result.status === 'rejected') {
        console.error('alert notification failed:', result.reason);
      }
    }
  };
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void tick()
      .catch((error: unknown) => console.error('alerts failed:', error))
      .finally(() => (running = false));
  }, every);
  return () => clearInterval(timer);
}
