import { ErrorState, PageHeader, TagChip } from '@project-graphite/ui';
import { useState } from 'react';
import { bytes, percent, post, type ProjectDetail, type User } from '../api';
import { Metrics } from '../components/Metrics';
import { usePoll } from '../usePoll';

function Wake({ slug, onWoken }: { slug: string; onWoken: () => void }) {
  const [message, setMessage] = useState<string>();
  const wake = () => {
    setMessage('Waking…');
    post(`/api/projects/${slug}/wake`).then(
      () => {
        setMessage('Awake for 30 minutes.');
        onWoken();
      },
      (error: Error) => setMessage(error.message),
    );
  };
  return (
    <span className="flex items-center gap-2">
      <button className="secondary-button" onClick={wake} type="button">
        Wake project
      </button>
      {message && <span className="mono-sm text-muted">{message}</span>}
    </span>
  );
}

export function ProjectPage({ slug, user }: { slug: string; user: User }) {
  const { data: project, error, reload } = usePoll<ProjectDetail>(`/api/projects/${slug}`);
  if (error && !project) {
    return <ErrorState title={`The console could not read ${slug}`}>{error.message}</ErrorState>;
  }
  if (!project) {
    return null;
  }
  const storage = project.storage ? project.storage.volumes + project.storage.images : null;
  return (
    <div className="space-y-6">
      <PageHeader
        actions={user.owner && project.sleeps && <Wake onWoken={() => void reload()} slug={slug} />}
        eyebrow={<a className="rule-link" href="#/">Overview</a>}
        title={slug}
      >
        <span className="flex flex-wrap items-center gap-2">
          {project.sleeps && <TagChip color={project.asleep ? 'gray' : 'teal'} label={project.asleep ? 'asleep' : 'awake'} />}
          <span className="mono-sm text-muted">
            cpu {percent(project.cpu)} · memory {bytes(project.memory)} · storage {bytes(storage)}
          </span>
        </span>
      </PageHeader>

      <Metrics query={`project=${slug}`} />

      <section className="stat-card space-y-2">
        <h2 className="mono-sm text-muted">Containers</h2>
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

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="stat-card space-y-2">
          <h2 className="mono-sm text-muted">Images · {bytes(project.storage?.images)}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>image</th>
                <th>size</th>
                <th>used by</th>
              </tr>
            </thead>
            <tbody>
              {project.images.map((image) => (
                <tr key={image.id}>
                  <td className="mono-sm break-all">{image.name.split('/').at(-1)}</td>
                  <td className="mono-sm">{bytes(image.size)}</td>
                  <td className="mono-sm text-muted">{image.usedBy.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stat-card space-y-2">
          <h2 className="mono-sm text-muted">Volumes · {bytes(project.storage?.volumes)}</h2>
          {project.volumes.length === 0 ? (
            <p className="mono-sm text-faint">No volumes.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>volume</th>
                  <th>size</th>
                  <th>in use</th>
                </tr>
              </thead>
              <tbody>
                {[...project.volumes]
                  .sort((a, b) => b.size - a.size)
                  .map((volume) => (
                    <tr key={volume.name}>
                      <td className="mono-sm break-all">{volume.name.replace(`${slug}_`, '')}</td>
                      <td className="mono-sm">{volume.size >= 0 ? bytes(volume.size) : '—'}</td>
                      <td className="text-muted">{volume.inUse ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
