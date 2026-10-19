import MuiLink from '@mui/material/Link';
import { Button, ErrorState, PageHeader, TagChip } from '@project-graphite/ui';
import { useState } from 'react';
import { bytes, can, percent, post, shortImage, stateColor, stateOf, type ProjectDetail, type User } from '../api';
import { Logs } from '../components/Logs';
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
      <Button onClick={wake}>Wake project</Button>
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
        actions={can(user, `project:${slug}`) && project.sleeps && <Wake onWoken={() => void reload()} slug={slug} />}
        eyebrow={<MuiLink href="#/" underline="always">Overview</MuiLink>}
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
                    <MuiLink href={`#/container/${container.id.slice(0, 12)}`} underline="always">
                      {container.service}
                    </MuiLink>
                  </td>
                  <td className="whitespace-nowrap">
                    <TagChip color={stateColor(container)} label={stateOf(container)} />
                  </td>
                  <td className="mono-sm whitespace-nowrap">{percent(container.cpu)}</td>
                  <td className="mono-sm whitespace-nowrap">
                    {bytes(container.memory)}
                    {container.memoryLimit ? <span className="text-faint"> / {bytes(container.memoryLimit)}</span> : null}
                  </td>
                  <td className="mono-sm max-w-64 truncate text-muted" title={container.image}>{shortImage(container.image)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="mono-sm text-muted">Logs</h2>
        {project.containers.map((container) => (
          <Logs
            collapsible
            container={container.id}
            key={container.id}
            name={container.name}
            open={project.containers.length === 1}
            running={container.state === 'running'}
          />
        ))}
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
                  <td className="mono-sm break-all" title={image.name}>{shortImage(image.name)}</td>
                  <td className="mono-sm whitespace-nowrap">{bytes(image.size)}</td>
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
                      <td className="mono-sm whitespace-nowrap">{volume.size >= 0 ? bytes(volume.size) : '—'}</td>
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
