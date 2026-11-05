import MuiLink from '@mui/material/Link';
import MuiTextField from '@mui/material/TextField';
import { EmptyState, ErrorState, PageHeader, timeAgo } from '@project-graphite/ui';
import { useState } from 'react';
import { post, type Alert, type AlertRule, type AlertsData } from '../api';
import { ActionButton } from '../components/ActionButton';
import { Rail, WithRail } from '../components/Rail';
import { Switch } from '../components/Switch';
import { usePoll } from '../usePoll';

function RuleRow({ rule, owner, onSaved }: { rule: AlertRule; owner: boolean; onSaved: () => void }) {
  const [threshold, setThreshold] = useState(String(rule.threshold));
  const [minutes, setMinutes] = useState(String(rule.minutes));
  const [enabled, setEnabled] = useState(rule.enabled);
  const changed = Number(threshold) !== rule.threshold || Number(minutes) !== rule.minutes || enabled !== rule.enabled;
  return (
    <tr>
      <td>
        <Switch checked={enabled} disabled={!owner} label={rule.label} onChange={setEnabled} />
      </td>
      <td>
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
          <span className="mono-sm text-faint">Ã¢â‚¬â€</span>
        )}
      </td>
      <td>
        <MuiTextField
          className="w-28"
          disabled={!owner}
          label="minutes"
          onChange={(event) => setMinutes(event.target.value)}
          size="small"
          slotProps={{ htmlInput: { min: 0, step: 'any' } }}
          type="number"
          value={minutes}
        />
      </td>
      <td className="text-right">
        {owner && (
          <ActionButton
            disabled={!changed}
            labels={{ idle: 'Save', busy: 'SavingÃ¢â‚¬Â¦', done: 'Saved', failed: 'Retry' }}
            run={() => post(`/api/alerts/rules/${rule.kind}`, { threshold: Number(threshold), minutes: Number(minutes), enabled }).then(onSaved)}
          />
        )}
      </td>
    </tr>
  );
}

function Rules({ data, owner, onSaved }: { data: AlertsData; owner: boolean; onSaved: () => void }) {
  return (
    <section className="stat-card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="mono-sm text-muted">Rules</h2>
        {owner && (
          <ActionButton
            disabled={!data.emailing}
            labels={{ idle: 'Send a test email', busy: 'SendingÃ¢â‚¬Â¦', done: 'Sent', failed: 'Not sent' }}
            run={() => post('/api/alerts/test')}
          />
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="data-table min-w-180 table-fixed">
          <colgroup>
            <col className="w-[46%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
            <col className="w-[18%]" />
          </colgroup>
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
              <RuleRow key={rule.kind} onSaved={onSaved} owner={owner} rule={rule} />
            ))}
          </tbody>
        </table>
      </div>
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
  const on = data.rules.filter((rule) => rule.enabled).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Alerts" />
      <WithRail
        rail={
          <Rail
            stats={[
              { label: 'Active', value: data.active.length ? `${data.active.length} active` : 'all clear', pill: data.active.length ? 'red' : 'green' },
              { label: 'Resolved, last 7 days', value: data.recent.length },
              { label: 'Rules on', value: `${on} of ${data.rules.length}` },
              { label: 'Checked', value: 'every 10 s' },
              { label: 'Email', value: data.emailing ? 'on' : 'off', detail: data.emailing ? undefined : 'needs SMTP_URL and ALERTS_EMAIL', pill: data.emailing ? 'green' : 'gray' },
              { label: 'GitHub issues', value: data.notifying ? 'on' : 'off', detail: data.notifying ? data.repo : 'needs ALERTS_TOKEN', pill: data.notifying ? 'green' : 'gray' },
            ]}
            title="Status"
          />
        }
      >
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
        <Rules data={data} onSaved={() => void reload()} owner={owner} />
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
                    <th aria-label="issue" />
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((alert) => (
                    <tr key={alert.id}>
                      <td>{alert.title}</td>
                      <td className="whitespace-nowrap text-muted">{timeAgo(new Date(alert.resolved!).toISOString())}</td>
                      <td className="mono-sm whitespace-nowrap">{duration(alert.since, alert.resolved!)}</td>
                      <td className="whitespace-nowrap text-right">
                        <Issue alert={alert} repo={data.repo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </WithRail>
    </div>
  );
}
