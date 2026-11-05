import { createHmac } from 'node:crypto';
import { defaultRules, type Condition, type Rule, type RuleKind } from './alerts.ts';
import { config } from './config.ts';
import type { ContainerView } from './inventory.ts';

export interface HubMetrics {
  windowMinutes: number;
  requests: number;
  errorRate: number;
  p95Ms: number | null;
  liveConnections: number;
}

type Rules = Record<RuleKind, Rule>;

const HUB = 'http://graphite-hub:3000';

let failedChecks = 0;

export function hubRunning(views: ContainerView[]) {
  return views.some((container) => container.project === 'graphite-hub' && container.service === 'app' && container.state === 'running');
}

export function hubConditions(failures: number, metrics: HubMetrics | undefined, rules: Rules = defaultRules): Condition[] {
  const percent = metrics ? 100 * metrics.errorRate : 0;
  return [
    ...(rules['hub-ready'].enabled && failures >= rules['hub-ready'].threshold
      ? [{ key: 'hub:ready', title: 'The hub is not ready', detail: `/health/ready failed ${failures} checks in a row.` }]
      : []),
    ...(metrics && rules['hub-errors'].enabled && percent > rules['hub-errors'].threshold
      ? [
          {
            key: 'hub:errors',
            title: `The hub answers ${percent.toFixed(1)}% of requests with errors`,
            detail: `Over ${rules['hub-errors'].threshold}% of ${metrics.requests} requests in the last ${metrics.windowMinutes} minutes; p95 ${metrics.p95Ms ?? 0} ms.`,
            for: rules['hub-errors'].minutes * 60_000,
          },
        ]
      : []),
  ];
}

export function signedHeaders(secret: string, now = Date.now()) {
  const stamp = String(Math.floor(now / 1000));
  return { 'X-Graphite-Timestamp': stamp, 'X-Graphite-Signature': createHmac('sha256', secret).update(`${stamp}.`).digest('hex') };
}

export async function checkHub(rules: Rules) {
  const secret = config.deployReportSecret;
  if (!secret) {
    return [];
  }
  const ready = await fetch(`${HUB}/health/ready`, { signal: AbortSignal.timeout(5_000) }).then(
    (response) => response.ok,
    () => false,
  );
  failedChecks = ready ? 0 : failedChecks + 1;
  if (!ready) {
    return hubConditions(failedChecks, undefined, rules);
  }
  const response = await fetch(`${HUB}/internal/metrics`, { headers: signedHeaders(secret), signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    return [
      {
        key: 'hub:metrics',
        title: 'The console cannot read the hub metrics',
        detail: `The hub answered ${response.status}; DEPLOY_REPORT_SECRET must match in the console and hub env files.`,
      },
    ];
  }
  return hubConditions(failedChecks, (await response.json()) as HubMetrics, rules);
}
