import MuiLink from '@mui/material/Link';
import MuiTextField from '@mui/material/TextField';
import { Button, EmptyState, ErrorState, PageHeader, timeAgo, Toggle } from '@project-graphite/ui';
import { useState } from 'react';
import { post, type Alert, type AlertRule, type AlertsData } from '../api';
import { usePoll } from '../usePoll';

function RuleRow({ rule, owner, onSaved }: { rule: AlertRule; owner: boolean; onSaved: () => void }) {
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const [minutes, setMinutes] = useState(String(rule.minutes));
  const [enabled, setEnabled] = useState(rule.enabled);
  const [message, setMessage] = useState<string>();
  const changed = Number(threshold) !== rule.threshold || Number(minutes) !== rule.minutes || enabled !== rule.enabled;
  const save = () =>
    post(`/api/alerts/rules/${rule.kind}`, { threshold: Number(threshold), minutes: Number(minutes), enabled }).then(
      () => {
        setMessage('Saved.');
        onSaved();
      },
      (error: Error) => setMessage(error.message),
    );
  return (
    <tr>
      <td>
        <Toggle checked={enabled} disabled={!owner} label={rule.label} onChange={setEnabled} />
      </td>
      <td className="whitespace-nowrap">
        {rule.unit ? (
          <MuiTextField
            className="w-28"
            disabled={!owner}
            label={rule.unit}
            onChange={(event) => setThreshold(event.target.value)}
            size="small"
            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
            type="number"
            value={threshold}
          />
        ) : (
          <span className="mono-sm text-faint">—</span>
        )}
      </td>
      <td className="whitespace-nowrap">
        <MuiTextField
          className="w-28"
          disabled={!owner}
          label="for minutes"
          onChange={(event) => setMinutes(event.target.value)}
          size="small"
          slotProps={{ htmlInput: { min: 0, step: 'any' } }}
          type="number"
          value={minutes}
        />
      </td>
      <td className="whitespace-nowrap">
        {owner && (
          <span className="flex items-center gap-2">
            <Button disabled={!changed} onClick={() => void save()} size="small">
              Save
            </Button>
            {message && <span className="mono-sm text-muted">{message}</span>}
          </span>
        )}
      </td>
    </tr>
  );
}

function Rules({ data, owner, onSaved }: { data: AlertsData; owner: boolean; onSaved: () => void }) {
  const [message, setMessage] = useState<string>();
  const test = () => {
    setMessage('Sending…');
    post('/api/alerts/test').then(
      () => setMessage('Sent; check the inbox.'),
      (error: Error) => setMessage(error.message),
    );
  };
  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="mono-sm text-muted">Rules</h2>
        {owner && (
          <span className="flex items-center gap-2">
            {message && <span className="mono-sm text-muted">{message}</span>}
            <Button disabled={!data.emailing} onClick={test} size="small">
              Send a test email
            </Button>
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>alert when</th>
              <th>threshold</th>
              <th>held for</th>
              <th aria-label="save" />
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <RuleRow key={`${rule.kind}-${rule.threshold}-${rule.minutes}-${rule.enabled}`} onSaved={onSaved} owner={owner} rule={rule} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono-sm text-faint">An alert resolves once its condition has been clear for a minute. CPU and memory of a container are measured against its own limits.</p>
    </section>
  );
}

function duration(from: number, to: number) {
  const minutes = Math.max(1, Math.round((to - from) / 60_000));
  return minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
}

function Issue({ alert, repo }: { alert: Alert; repo: string }) {
  return alert.issue ? (
    <MuiLink className="mono-sm text-muted" href={`https://github.com/${repo}/issues/${alert.issue}`} rel="noreferrer" target="_blank" underline="always">
      issue #{alert.issue}
    </MuiLink>
  ) : null;
}

export function Alerts({ owner }: { owner: boolean }) {
  const { data, error, reload } = usePoll<AlertsData>('/api/alerts', 10_000);
  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not read its alerts">{error.message}</ErrorState>;
  }
  if (!data) {
    return null;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Alerts">
        <span className="mono-sm text-muted">
          Checked every 10 seconds against the rules below. {data.emailing ? 'Each alert and its recovery are emailed.' : 'Email is off until SMTP_URL and ALERTS_EMAIL are set.'}{' '}
          {data.notifying ? `Each alert also opens an issue in ${data.repo}.` : 'GitHub issues are off until ALERTS_TOKEN is set.'}
        </span>
      </PageHeader>
      {data.active.length === 0 ? (
        <EmptyState title="All clear">Nothing needs attention.</EmptyState>
      ) : (
        <section className="space-y-3">
          {data.active.map((alert) => (
            <div className="stat-card space-y-1 border-l-4 border-l-[#e5736b]" key={alert.id}>
              <p className="text-base text-ink">{alert.title}</p>
              <p className="text-sm text-muted">{alert.detail}</p>
              <p className="flex flex-wrap gap-3">
                <span className="mono-sm text-faint">since {timeAgo(new Date(alert.since).toISOString())}</span>
                <Issue alert={alert} repo={data.repo} />
              </p>
            </div>
          ))}
        </section>
      )}
      {data.recent.length > 0 && (
        <section className="stat-card space-y-2">
          <h2 className="mono-sm text-muted">Resolved in the last 7 days</h2>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>alert</th>
                  <th>resolved</th>
                  <th>lasted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.recent.map((alert) => (
                  <tr key={alert.id}>
                    <td>{alert.title}</td>
                    <td className="whitespace-nowrap text-muted">{timeAgo(new Date(alert.resolved!).toISOString())}</td>
                    <td className="mono-sm whitespace-nowrap">{duration(alert.since, alert.resolved!)}</td>
                    <td className="whitespace-nowrap">
                      <Issue alert={alert} repo={data.repo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Rules data={data} onSaved={() => void reload()} owner={owner} />
    </div>
  );
}
