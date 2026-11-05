import MuiLink from '@mui/material/Link';
import { Button, ConfirmDialog, ErrorState, PageHeader, Select, TagChip, timeAgo } from '@project-graphite/ui';
import { useRef, useState } from 'react';
import { bytes, post, stampDate, type BackupsData, type BackupSummary, type Overview } from '../api';
import { usePoll } from '../usePoll';

const requestColors = { waiting: 'gray', running: 'blue', done: 'green', failed: 'red' } as const;

function Archive({ archive, onRestore }: { archive: BackupSummary; onRestore: () => void }) {
  const volumes = archive.items.filter((item) => item.kind === 'volume');
  const databases = archive.items.filter((item) => item.kind === 'postgres');
  const sqlite = volumes.reduce((sum, item) => sum + (item.sqlite?.length ?? 0), 0);
  return (
    <tr>
      <td className="mono-sm whitespace-nowrap">
        {stampDate(archive.stamp).toISOString().slice(0, 16).replace('T', ' ')}
        <span className="text-faint"> · {timeAgo(stampDate(archive.stamp).toISOString())}</span>
      </td>
      <td className="whitespace-nowrap">
        <span className="flex items-center gap-1">
          <TagChip color={archive.ok ? 'green' : 'red'} label={archive.ok ? 'verified' : 'failed'} />
          {archive.imported && <TagChip label="imported" />}
        </span>
      </td>
      <td className="mono-sm text-muted">
        {[databases.length && `${databases.length} database dump${databases.length > 1 ? 's' : ''}`, volumes.length && `${volumes.length} volume${volumes.length > 1 ? 's' : ''}`, sqlite && `${sqlite} SQLite`]
          .filter(Boolean)
          .join(' · ')}
        {archive.errors.length > 0 && <div className="break-all text-faint">{archive.errors.join('; ')}</div>}
      </td>
      <td className="mono-sm whitespace-nowrap">{bytes(archive.bytes)}</td>
      <td className="whitespace-nowrap">
        {archive.bytes !== undefined && (
          <span className="flex items-center gap-2">
            <MuiLink className="mono-sm" href={`/api/backups/${archive.project}/${archive.stamp}.tar`} underline="always">
              download
            </MuiLink>
            {archive.ok && (
              <Button onClick={onRestore} size="small">
                Restore
              </Button>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}

function Import({ projects, onDone }: { projects: string[]; onDone: () => void }) {
  const [project, setProject] = useState('');
  const [message, setMessage] = useState<string>();
  const file = useRef<HTMLInputElement>(null);
  const send = () => {
    const chosen = file.current?.files?.[0];
    if (!project || !chosen) {
      setMessage('Choose a project and an archive.');
      return;
    }
    setMessage('Uploading…');
    fetch(`/api/backups/${project}/import`, { method: 'POST', headers: { 'Content-Type': 'application/x-tar' }, body: chosen })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error((await response.text()) || `The console answered ${response.status}.`);
        }
        setMessage('Uploaded; the backup service is verifying it. Restore it from the list once it shows verified.');
        onDone();
      })
      .catch((error: Error) => setMessage(error.message));
  };
  return (
    <section className="stat-card space-y-3">
      <h2 className="mono-sm text-muted">Import an archive</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Select label="Project" onChange={setProject} options={projects.map((slug) => ({ value: slug, label: slug }))} placeholder="Project" value={project} />
        </div>
        <input accept=".tar,application/x-tar" className="mono-sm" ref={file} type="file" />
        <Button icon="upload" onClick={send} size="small">
          Upload
        </Button>
      </div>
      {message && <p className="mono-sm text-muted">{message}</p>}
    </section>
  );
}

export function Backups() {
  const { data, error, reload } = usePoll<BackupsData>('/api/backups', 10_000);
  const overview = usePoll<Overview>('/api/overview', 60_000);
  const [restoring, setRestoring] = useState<BackupSummary>();
  const [message, setMessage] = useState<string>();
  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not list the backups">{error.message}</ErrorState>;
  }
  if (!data) {
    return null;
  }
  const run = (project: string) =>
    post(`/api/backups/${project}/run`).then(
      () => {
        setMessage(`Asked the backup service to back up ${project}.`);
        void reload();
      },
      (reason: Error) => setMessage(reason.message),
    );
  const projects = [...new Set([...data.projects.map((entry) => entry.project), ...(overview.data?.projects ?? []).map((project) => project.slug)])].sort();
  return (
    <div className="space-y-6">
      <PageHeader title="Backups">
        <span className="mono-sm text-muted">
          Every night at 03:00 UTC the backup service dumps each database labelled graphite.backup.postgres and archives each volume labelled graphite.backup,
          with consistent copies of the SQLite databases inside, then reopens and verifies every archive. Archives are kept for 14 days.
        </span>
      </PageHeader>
      {message && <p className="mono-sm text-muted">{message}</p>}
      {data.requests.length > 0 && (
        <section className="stat-card space-y-2">
          <h2 className="mono-sm text-muted">Recent requests</h2>
          <table className="data-table">
            <tbody>
              {data.requests.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap">
                    <TagChip color={requestColors[entry.state]} label={entry.state} />
                  </td>
                  <td className="mono-sm whitespace-nowrap">
                    {entry.action} {entry.project}
                    {entry.archive && <span className="text-faint"> {entry.archive}</span>}
                  </td>
                  <td className="mono-sm text-muted">{entry.by}</td>
                  <td className="mono-sm break-all text-muted">{entry.output}</td>
                  <td className="mono-sm whitespace-nowrap text-faint">{entry.at && timeAgo(entry.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {data.projects.map(({ project, archives }) => (
        <section className="stat-card space-y-2" key={project}>
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="mono-sm">{project}</h2>
            <Button onClick={() => void run(project)} size="small">
              Back up now
            </Button>
          </header>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>taken</th>
                  <th>check</th>
                  <th>contents</th>
                  <th>size</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {archives.map((archive) => (
                  <Archive archive={archive} key={archive.stamp} onRestore={() => setRestoring(archive)} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {data.projects.length === 0 && <p className="mono-sm text-faint">No backup has run yet.</p>}
      <Import onDone={() => void reload()} projects={projects} />
      {restoring && (
        <ConfirmDialog
          confirmLabel="Restore"
          onClose={() => setRestoring(undefined)}
          onConfirm={() =>
            post(`/api/backups/${restoring.project}/${restoring.stamp}/restore`).then(() => {
              setMessage(`Asked the backup service to restore ${restoring.project}.`);
              void reload();
            })
          }
          title={`Restore ${restoring.project} from ${stampDate(restoring.stamp).toISOString().slice(0, 16).replace('T', ' ')}?`}
          tone="danger"
        >
          The project stops, its databases and volumes are replaced by this archive, and it starts again. Everything written since the archive was taken is lost.
        </ConfirmDialog>
      )}
    </div>
  );
}
