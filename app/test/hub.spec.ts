import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultRules } from '../src/server/alerts.ts';
import { hubConditions, hubRunning, signedHeaders, type HubMetrics } from '../src/server/hub.ts';
import type { ContainerView } from '../src/server/inventory.ts';

const metrics = (errorRate: number): HubMetrics => ({ windowMinutes: 5, requests: 400, errorRate, p95Ms: 42, liveConnections: 3 });

describe('hubConditions', () => {
  it('alerts when more than one percent of requests fail over the window', () => {
    expect(hubConditions(0, metrics(0.01))).toEqual([]);
    expect(hubConditions(0, metrics(0.025))).toEqual([
      expect.objectContaining({ key: 'hub:errors', title: 'The hub answers 2.5% of requests with errors' }),
    ]);
  });

  it('alerts when readiness fails twice in a row', () => {
    expect(hubConditions(1, undefined)).toEqual([]);
    expect(hubConditions(2, undefined)).toEqual([expect.objectContaining({ key: 'hub:ready' })]);
  });

  it('follows the edited rules', () => {
    const rules = {
      ...defaultRules,
      'hub-errors': { ...defaultRules['hub-errors'], threshold: 5 },
      'hub-ready': { ...defaultRules['hub-ready'], enabled: false },
    };
    expect(hubConditions(9, metrics(0.04), rules)).toEqual([]);
  });
});

describe('hubRunning', () => {
  it('looks for the running hub app container', () => {
    const view = { project: 'graphite-hub', service: 'app', state: 'running' } as ContainerView;
    expect(hubRunning([view])).toBe(true);
    expect(hubRunning([{ ...view, state: 'exited' }])).toBe(false);
    expect(hubRunning([{ ...view, project: 'strata' }])).toBe(false);
  });
});

describe('signedHeaders', () => {
  it('signs an empty body the way the hub verifies it', () => {
    const headers = signedHeaders('shared', 1_700_000_000_000);
    expect(headers['X-Graphite-Timestamp']).toBe('1700000000');
    expect(headers['X-Graphite-Signature']).toBe(createHmac('sha256', 'shared').update('1700000000.').digest('hex'));
  });
});
