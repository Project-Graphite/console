import { EmptyState, ErrorState, Meter, PageHeader, TagChip } from '@project-graphite/ui';
import { bytes, percent, type Host, type Overview as OverviewData, type Point, type Project } from '../api';
import { Sparkline } from '../components/Sparkline';
import { usePoll } from '../usePoll';

function HostCards({ host }: { host: Host }) {
  const { data: history } = usePoll<Point[]>('/api/history?target=host', 60_000);
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
      <div className="stat-card sm:col-span-2 lg:col-span-4">
        <p className="mono-sm mb-2 text-muted">CPU, last 24 hours</p>
        <Sparkline label="Host CPU over the last 24 hours" max={100} values={(history ?? []).map((point) => point.cpu)} />
      </div>
    </section>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <section className="stat-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg">{project.slug}</h2>
        {project.sleeps && <TagChip color={project.asleep ? 'gray' : 'teal'} label={project.asleep ? 'asleep' : 'awake'} />}
      </header>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>service</th>
              <th>state</th>
              <th>cpu</th>
              <th>memory</th>
              <th>image</th>
            </tr>
          </thead>
          <tbody>
            {project.containers.map((container) => (
              <tr key={container.id}>
                <td>
                  <a className="rule-link" href={`#/container/${container.id.slice(0, 12)}`}>
                    {container.service}
                  </a>
                </td>
                <td>
                  <TagChip
                    color={container.state !== 'running' ? 'gray' : container.health === 'unhealthy' ? 'red' : 'green'}
                    label={container.health ?? container.state}
                  />
                </td>
                <td className="mono-sm">{percent(container.cpu)}</td>
                <td className="mono-sm">
                  {bytes(container.memory)}
                  {container.memoryLimit ? <span className="text-faint"> / {bytes(container.memoryLimit)}</span> : null}
                </td>
                <td className="mono-sm max-w-64 truncate text-muted">{container.image.split('/').at(-1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Overview() {
  const { data, error, reload } = usePoll<OverviewData>('/api/overview');
  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not read the VPS">{error.message}</ErrorState>;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" />
      {data?.host && <HostCards host={data.host} />}
      {data && data.projects.length === 0 && <EmptyState title="No projects to show">Nothing you own runs on the VPS yet.</EmptyState>}
      <div className="space-y-4">
        {data?.projects.map((project) => <ProjectCard key={project.slug} project={project} />)}
      </div>
    </div>
  );
}
