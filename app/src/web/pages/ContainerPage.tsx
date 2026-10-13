import { ConfirmDialog, ErrorState, PageHeader, TagChip, timeAgo } from '@project-graphite/ui';
import { useState } from 'react';
import { bytes, percent, post, type Container, type Overview, type Point, type User } from '../api';
import { Logs } from '../components/Logs';
import { Sparkline } from '../components/Sparkline';
import { LazyTerminal } from '../components/LazyTerminal';
import { usePoll } from '../usePoll';

function Actions({ container, project, sleeps }: { container: Container; project: string; sleeps: boolean }) {
  const [confirm, setConfirm] = useState<'stop' | 'restart'>();
  const [message, setMessage] = useState<string>();
  const run = async (path: string, done: string) => {
    setMessage(undefined);
    await post(path);
    setMessage(done);
  };
  const attempt = (path: string, done: string) => void run(path, done).catch((error: Error) => setMessage(error.message));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {container.state === 'running' ? (
        <>
          <button className="secondary-button" onClick={() => setConfirm('restart')} type="button">Restart</button>
          <button className="secondary-button" onClick={() => setConfirm('stop')} type="button">Stop</button>
        </>
      ) : (
        <button className="primary-button" onClick={() => attempt(`/api/containers/${container.id}/start`, 'Started.')} type="button">
          Start
        </button>
      )}
      {sleeps && (
        <button className="secondary-button" onClick={() => attempt(`/api/projects/${project}/wake`, 'Awake for 30 minutes.')} type="button">
          Wake project
        </button>
      )}
      {message && <span className="mono-sm text-muted">{message}</span>}
      {confirm && (
        <ConfirmDialog
          confirmLabel={confirm === 'stop' ? 'Stop' : 'Restart'}
          onClose={() => setConfirm(undefined)}
          onConfirm={() => run(`/api/containers/${container.id}/${confirm}`, confirm === 'stop' ? 'Stopped.' : 'Restarted.')}
          title={`${confirm === 'stop' ? 'Stop' : 'Restart'} ${container.name}?`}
        >
          {confirm === 'stop' ? 'It stays stopped until you start it or the project deploys again.' : 'It goes down for a moment while it restarts.'}
        </ConfirmDialog>
      )}
    </div>
  );
}

function Ports({ container, ssh }: { container: Container; ssh: string | null }) {
  const address = Object.values(container.networks)[0];
  if (!container.ports.length) {
    return null;
  }
  return (
    <section className="stat-card space-y-3">
      <h2 className="mono-sm text-muted">Ports</h2>
      {container.ports.map((port) => (
        <div className="space-y-1" key={port}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="mono-sm">{port}</span>
            <a className="rule-link" href={`/open/${container.id}/${port}/`} rel="noreferrer" target="_blank">
              open in the browser
            </a>
          </div>
          {address && ssh && (
            <code className="mono-sm block break-all text-faint">
              ssh -L {port}:{address}:{port} {ssh}
            </code>
          )}
        </div>
      ))}
    </section>
  );
}

export function ContainerPage({ id, user }: { id: string; user: User }) {
  const { data, error } = usePoll<Overview>('/api/overview');
  const [shell, setShell] = useState(false);
  const project = data?.projects.find((candidate) => candidate.containers.some((container) => container.id.startsWith(id)));
  const container = project?.containers.find((candidate) => candidate.id.startsWith(id));
  const { data: history } = usePoll<Point[]>(`/api/history?target=${container?.name ?? ''}`, 60_000);

  if (error && !data) {
    return <ErrorState title="The console could not read the VPS">{error.message}</ErrorState>;
  }
  if (!data) {
    return null;
  }
  if (!container || !project) {
    return <ErrorState title="No such container">It may have been removed or recreated by a deploy.</ErrorState>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={user.owner && <Actions container={container} project={project.slug} sleeps={project.sleeps} />}
        eyebrow={<a className="rule-link" href="#/">{project.slug}</a>}
        title={container.service}
      >
        <span className="flex flex-wrap items-center gap-2">
          <TagChip color={container.state === 'running' ? 'green' : 'gray'} label={container.health ?? container.state} />
          <span className="mono-sm text-muted">{container.status}</span>
        </span>
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="stat-card space-y-2">
          <p className="mono-sm text-muted">CPU now {percent(container.cpu)}</p>
          <Sparkline label="CPU over the last 24 hours" max={100} values={(history ?? []).map((point) => point.cpu)} />
        </div>
        <div className="stat-card space-y-2">
          <p className="mono-sm text-muted">
            Memory now {bytes(container.memory)}
            {container.memoryLimit ? ` of ${bytes(container.memoryLimit)}` : ''}
          </p>
          <Sparkline label="Memory over the last 24 hours" max={container.memoryLimit ?? undefined} values={(history ?? []).map((point) => point.memory)} />
        </div>
      </section>

      <section className="stat-card">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">image</dt>
          <dd className="mono-sm break-all">{container.image}</dd>
          <dt className="text-muted">container</dt>
          <dd className="mono-sm">{container.name} · {container.id.slice(0, 12)}</dd>
          <dt className="text-muted">created</dt>
          <dd>{timeAgo(new Date(container.created).toISOString())}</dd>
          {Object.entries(container.networks).map(([network, address]) => (
            <div className="contents" key={network}>
              <dt className="text-muted">{network}</dt>
              <dd className="mono-sm">{address}</dd>
            </div>
          ))}
        </dl>
      </section>

      {user.owner && <Ports container={container} ssh={user.ssh} />}

      <section className="space-y-2">
        <h2 className="mono-sm text-muted">Logs</h2>
        <Logs container={container.id} />
      </section>

      {user.owner && container.state === 'running' && (
        <section className="space-y-2">
          <div className="flex items-center gap-3">
            <h2 className="mono-sm text-muted">Shell</h2>
            <button className="secondary-button" onClick={() => setShell(!shell)} type="button">
              {shell ? 'Close' : 'Open a shell'}
            </button>
          </div>
          {shell && <LazyTerminal path={`/ws/terminal?container=${container.id}`} />}
        </section>
      )}
    </div>
  );
}
