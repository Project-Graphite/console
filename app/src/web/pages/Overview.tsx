import { EmptyState, ErrorState, Meter, PageHeader, TagChip } from '@project-graphite/ui';
import { useState } from 'react';
import { bytes, completed, percent, type AlertsData, type Host, type Overview as OverviewData, type Project } from '../api';
import { Metrics } from '../components/Metrics';
import { load, save } from '../stored';
import { usePoll } from '../usePoll';

function HostCards({ host }: { host: Host }) {
  const cards = [
    { label: 'CPU', value: percent(host.cpu), detail: `${host.cpus} cores · load ${host.load.map((value) => value.toFixed(2)).join(' ')}`, ratio: host.cpu / 100 },
    { label: 'Memory', value: bytes(host.memory.used), detail: `of ${bytes(host.memory.total)}`, ratio: host.memory.used / host.memory.total },
    { label: 'Swap', value: bytes(host.swap.used), detail: `of ${bytes(host.swap.total)}`, ratio: host.swap.total ? host.swap.used / host.swap.total : 0 },
    { label: 'Disk', value: bytes(host.disk.used), detail: `of ${bytes(host.disk.total)}`, ratio: host.disk.used / host.disk.total },
  ];
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div className="stat-card space-y-2" key={card.label}>
          <p className="mono-sm text-muted">{card.label}</p>
          <p className="text-2xl">{card.value}</p>
          <Meter label={card.label} value={card.ratio} />
          <p className="mono-sm text-faint">{card.detail}</p>
        </div>
      ))}
    </section>
  );
}

function Storage({ host, docker }: { host: Host; docker: NonNullable<OverviewData['docker']> }) {
  const parts = [
    { label: 'images', size: docker.images },
    { label: 'volumes', size: docker.volumes },
    { label: 'container layers', size: docker.containers },
    { label: 'build cache', size: docker.buildCache },
  ];
  const other = Math.max(0, host.disk.used - parts.reduce((sum, part) => sum + part.size, 0));
  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="mono-sm text-muted">Storage</h2>
        <span className="mono-sm text-muted">
          {bytes(host.disk.used)} of {bytes(host.disk.total)} · {bytes(host.disk.total - host.disk.used)} free
        </span>
      </div>
      <Meter label="Disk" value={host.disk.used / host.disk.total} />
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
        {[...parts, { label: 'system and other', size: other }].map((part) => (
          <div key={part.label}>
            <dt className="mono-sm text-faint">{part.label}</dt>
            <dd className="mono-sm">{bytes(part.size)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function status(project: Project) {
  const services = project.containers.filter((container) => !completed(container));
  const running = services.filter((container) => container.state === 'running').length;
  const unhealthy = services.some((container) => container.health === 'unhealthy');
  if (project.asleep) return <TagChip color="gray" label="asleep" />;
  if (unhealthy) return <TagChip color="red" label="unhealthy" />;
  return <TagChip color={running === services.length ? 'green' : 'yellow'} label={`${running}/${services.length} running`} />;
}

function ProjectList({ projects }: { projects: Project[] }) {
  const [filter, setFilter] = useState('');
  const [pinned, setPinned] = useState<string[]>(() => load<string[]>('console.pinned', []));
  const toggle = (slug: string) => {
    const next = pinned.includes(slug) ? pinned.filter((entry) => entry !== slug) : [...pinned, slug];
    setPinned(next);
    save('console.pinned', next);
  };
  const shown = projects
    .filter((project) => project.slug.includes(filter.trim().toLowerCase()))
    .sort((a, b) => Number(pinned.includes(b.slug)) - Number(pinned.includes(a.slug)) || a.slug.localeCompare(b.slug));
  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="mono-sm text-muted">Projects</h2>
        <input aria-label="Filter projects" className="max-w-56" onChange={(event) => setFilter(event.target.value)} placeholder="Filter projects" type="search" value={filter} />
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th aria-label="pinned" />
              <th>project</th>
              <th>status</th>
              <th>cpu</th>
              <th>memory</th>
              <th>storage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((project) => (
              <tr key={project.slug}>
                <td className="w-8">
                  <button
                    aria-label={pinned.includes(project.slug) ? `Unpin ${project.slug}` : `Pin ${project.slug}`}
                    aria-pressed={pinned.includes(project.slug)}
                    className={pinned.includes(project.slug) ? 'text-ink' : 'text-faint hover:text-muted'}
                    onClick={() => toggle(project.slug)}
                    type="button"
                  >
                    {pinned.includes(project.slug) ? '★' : '☆'}
                  </button>
                </td>
                <td>
                  <a className="rule-link" href={`#/project/${project.slug}`}>
                    {project.slug}
                  </a>
                </td>
                <td className="whitespace-nowrap">{status(project)}</td>
                <td className="mono-sm whitespace-nowrap">{percent(project.cpu)}</td>
                <td className="mono-sm whitespace-nowrap">{bytes(project.memory)}</td>
                <td className="mono-sm whitespace-nowrap">{project.storage ? bytes(project.storage.volumes + project.storage.images) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="mono-sm text-faint">No project matches “{filter}”.</p>}
    </section>
  );
}

export function Overview() {
  const { data, error, reload } = usePoll<OverviewData>('/api/overview');
  const active = usePoll<AlertsData>('/api/alerts', 60_000).data?.active ?? [];
  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not read the VPS">{error.message}</ErrorState>;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" />
      {active.length > 0 && (
        <a className="stat-card block border-l-4 border-l-[#e5736b] hover:bg-paper" href="#/alerts">
          <p className="text-ink">{active.length === 1 ? active[0].title : `${active.length} alerts need attention`}</p>
          <p className="mono-sm text-muted">{active.length === 1 ? active[0].detail : active.map((alert) => alert.title).join(' · ')}</p>
        </a>
      )}
      {data?.host && <HostCards host={data.host} />}
      {data?.host && <Metrics cpuMax={100} memoryMax={data.host.memory.total} query="target=host" />}
      {data?.host && data.docker && <Storage docker={data.docker} host={data.host} />}
      {data && data.projects.length === 0 && <EmptyState title="No projects to show">Nothing you own runs on the VPS yet.</EmptyState>}
      {data && data.projects.length > 0 && <ProjectList projects={data.projects} />}
    </div>
  );
}
