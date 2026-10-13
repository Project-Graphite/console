import { EmptyState, ErrorState, PageHeader, timeAgo } from '@project-graphite/ui';
import type { Alert, AlertsData } from '../api';
import { usePoll } from '../usePoll';

function duration(from: number, to: number) {
  const minutes = Math.max(1, Math.round((to - from) / 60_000));
  return minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`;
}

function Issue({ alert, repo }: { alert: Alert; repo: string }) {
  return alert.issue ? (
    <a className="mono-sm rule-link text-muted" href={`https://github.com/${repo}/issues/${alert.issue}`} rel="noreferrer" target="_blank">
      issue #{alert.issue}
    </a>
  ) : null;
}

export function Alerts() {
  const { data, error, reload } = usePoll<AlertsData>('/api/alerts', 30_000);
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
          Checked every minute: stopped, unhealthy or restarting containers, host memory, swap and disk, and backups.{' '}
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
    </div>
  );
}
