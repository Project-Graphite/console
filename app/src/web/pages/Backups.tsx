import MuiLink from '@mui/material/Link';
import MuiTextField from '@mui/material/TextField';
import { Button, ConfirmDialog, ErrorState, PageHeader, Select, TagChip, timeAgo } from '@project-graphite/ui';
import { useRef, useState } from 'react';
import { bytes, post, stampDate, type BackupSchedule, type BackupsData, type BackupSummary, type Overview } from '../api';
import { ActionButton } from '../components/ActionButton';
import { Rail, WithRail } from '../components/Rail';
import { Switch } from '../components/Switch';
import { usePoll } from '../usePoll';

const requestColors = { waiting: 'gray', running: 'blue', done: 'green', failed: 'red' } as const;
const periods = [1, 2, 3, 4, 6, 8, 12, 24, 48, 72, 168];
const every = (hours: number) => (hours < 24 ? `every ${hours} h` : hours === 24 ? 'daily' : hours === 168 ? 'weekly' : `every ${hours / 24} days`);
const clock = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ');

function Archive({ archive, onRestore }: { archive: BackupSummary; onRestore: () => void }) {
  const volumes = archive.items.filter((item) => item.kind === 'volume');
  const databases = archive.items.filter((item) => item.kind === 'postgres');
  const sqlite = volumes.reduce((sum, item) => sum + (item.sqlite?.length ?? 0), 0);
  return (
    <tr>
      <td className="mono-sm whitespace-nowrap">
        {clock(stampDate(archive.stamp).getTime())}
        <span className="text-faint"> Ã‚Â· {timeAgo(stampDate(archive.stamp).toISOString())}</span>
      </td>
      <td className="whitespace-nowrap">
        <span className="flex items-center gap-1">
          <TagChip color={archive.ok ? 'green' : 'red'} label={archive.ok ? 'verified' : 'failed'} />
          {archive.imported && <TagChip color="blue" label="imported" />}
        </span>
      </td>
      <td className="mono-sm text-muted">
        {[databases.length && `${databases.length} database dump${databases.length > 1 ? 's' : ''}`, volumes.length && `${volumes.length} volume${volumes.length > 1 ? 's' : ''}`, sqlite && `${sqlite} SQLite`]
          .filter(Boolean)
          .join(' Ã‚Â· ')}
        {archive.errors.length > 0 && <div className="break-all text-faint">{archive.errors.join('; ')}</div>}
      </td>
      <td className="mono-sm whitespace-nowrap">{bytes(archive.bytes)}</td>
      <td className="whitespace-nowrap">
        {archive.bytes !== undefined && (
          <span className="flex items-center justify-end gap-2">
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

function ScheduleEditor({ schedule, onSaved }: { schedule: BackupSchedule; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [everyHours, setEveryHours] = useState(schedule.everyHours);
  const [hour, setHour] = useState(schedule.hour);
  const [keepDays, setKeepDays] = useState(String(schedule.keepDays));
  const changed = enabled !== schedule.enabled || everyHours !== schedule.everyHours || hour !== schedule.hour || Number(keepDays) !== schedule.keepDays;
  return (
    <div className="space-y-3 border-t border-line-soft pt-4">
      <h3 className="mono-sm text-muted">Schedule</h3>
      <Switch checked={enabled} label="Back up on a schedule" onChange={setEnabled} />
      <Select
        disabled={!enabled}
        label="Frequency"
        onChange={(value) => setEveryHours(Number(value))}
        options={periods.map((hours) => ({ value: String(hours), label: every(hours) }))}
        value={String(everyHours)}
      />
      <Select
        disabled={!enabled}
        label="Starting at, UTC"
        onChange={(value) => setHour(Number(value))}
        options={Array.from({ length: 24 }, (_, value) => ({ value: String(value), label: `${String(value).padStart(2, '0')}:00` }))}
        value={String(hour)}
      />
      <MuiTextField
        fullWidth
        label="Keep, days"
        onChange={(event) => setKeepDays(event.target.value)}
        size="small"
        slotProps={{ htmlInput: { min: 1, max: 90, step: 1 } }}
        type="number"
        value={keepDays}
      />
      <div className="flex justify-end">
        <ActionButton
          disabled={!changed}
          labels={{ idle: 'Save', busy: 'SavingÃ¢â‚¬Â¦', done: 'Saved', failed: 'Retry' }}
          run={() => post('/api/backups/schedule', { enabled, everyHours, hour, keepDays: Number(keepDays) }).then(onSaved)}
        />
      </div>
    </div>
  );
}

function Import({ projects, onDone }: { projects: string[]; onDone: () => void }) {
  const [project, setProject] = useState('');
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const send = async () => {
    const chosen = file.current?.files?.[0];
    if (!project || !chosen) {
      throw new Error('Choose a project and an archive.');
    }
    const response = await fetch(`/api/backups/${project}/import`, { method: 'POST', headers: { 'Content-Type': 'application/x-tar' }, body: chosen });
    if (!response.ok) {
      throw new Error((await response.text()) || `The console answered ${response.status}.`);
    }
    onDone();
  };
  return (
    <section className="stat-card space-y-3">
      <h2 className="mono-sm text-muted">Import an archive</h2>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select label="Project" onChange={setProject} options={projects.map((slug) => ({ value: slug, label: slug }))} placeholder="Project" value={project} />
        </div>
        <Button icon="file" onClick={() => file.current?.click()} size="small">
          {name || 'Choose archive'}
        </Button>
        <input accept=".tar,application/x-tar" className="hidden" onChange={(event) => setName(event.target.files?.[0]?.name ?? '')} ref={file} type="file" />
        <span className="ml-auto">
          <ActionButton disabled={!project || !name} labels={{ idle: 'Upload', busy: 'UploadingÃ¢â‚¬Â¦', done: 'Uploaded', failed: 'Retry' }} run={send} variant="primary" />
        </span>
      </div>
    </section>
  );
}

export function Backups() {
  const { data, error, reload } = usePoll<BackupsData>('/api/backups', 10_000);
  const overview = usePoll<Overview>('/api/overview', 60_000);
  const [restoring, setRestoring] = useState<BackupSummary>();
  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not list the backups">{error.message}</ErrorState>;
  }
  if (!data) {
    return null;
  }
  const projects = [...new Set([...data.projects.map((entry) => entry.project), ...(overview.data?.projects ?? []).map((project) => project.slug)])].sort();
  const latest = data.projects.flatMap(({ archives }) => archives.filter((archive) => !archive.imported).slice(0, 1));
  const verified = latest.filter((archive) => archive.ok).length;
  const archives = data.projects.flatMap((entry) => entry.archives);
  const last = latest.map((archive) => archive.stamp).sort().at(-1);
  return (
    <div className="space-y-6">
      <PageHeader title="Backups" />
      <WithRail
        rail={
          <Rail
            stats={[
              { label: 'Schedule', value: data.schedule.enabled ? `${every(data.schedule.everyHours)} from ${String(data.schedule.hour).padStart(2, '0')}:00 UTC` : 'off', pill: data.schedule.enabled ? 'green' : 'gray' },
              { label: 'Next run', value: data.next ? `${clock(data.next)} UTC` : 'Ã¢â‚¬â€' },
              { label: 'Last run', value: last ? timeAgo(stampDate(last).toISOString()) : 'never' },
              {
                label: 'Latest per project',
                value: latest.length ? `${verified} of ${latest.length} verified` : 'none yet',
                pill: !latest.length ? 'gray' : verified === latest.length ? 'green' : 'red',
              },
              { label: 'Archives', value: archives.length, detail: bytes(archives.reduce((sum, archive) => sum + (archive.bytes ?? 0), 0)) },
              { label: 'Kept', value: `${data.schedule.keepDays} days` },
            ]}
            title="Status"
          >
            <ScheduleEditor key={JSON.stringify(data.schedule)} onSaved={() => void reload()} schedule={data.schedule} />
          </Rail>
        }
      >
        {data.requests.length > 0 && (
          <section className="stat-card space-y-2">
            <h2 className="mono-sm text-muted">Recent requests</h2>
            <div className="overflow-x-auto">
              <table className="data-table min-w-180 table-fixed">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[28%]" />
                  <col className="w-[14%]" />
                  <col className="w-[30%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <tbody>
                  {data.requests.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap">
                        <TagChip color={requestColors[entry.state]} label={entry.state} />
                      </td>
                      <td className="mono-sm truncate">
                        {entry.action} {entry.project}
                        {entry.archive && <span className="text-faint"> {entry.archive}</span>}
                      </td>
                      <td className="mono-sm truncate text-muted">{entry.by}</td>
                      <td className="mono-sm break-all text-muted">{entry.output}</td>
                      <td className="mono-sm whitespace-nowrap text-right text-faint">{entry.at && timeAgo(entry.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {data.projects.map(({ project, archives: list }) => (
          <section className="stat-card space-y-2" key={project}>
            <header className="flex items-center justify-between gap-2">
              <h2 className="mono-sm flex items-center gap-2">
                {project}
                {list[0] && <TagChip color={list[0].ok ? 'green' : 'red'} label={list[0].ok ? 'latest verified' : 'latest failed'} />}
              </h2>
              <ActionButton labels={{ idle: 'Back up now', busy: 'RequestingÃ¢â‚¬Â¦', done: 'Requested', failed: 'Retry' }} run={() => post(`/api/backups/${project}/run`).then(() => reload())} />
            </header>
            <div className="overflow-x-auto">
              <table className="data-table min-w-180 table-fixed">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[14%]" />
                  <col className="w-[30%]" />
                  <col className="w-[10%]" />
                  <col className="w-[20%]" />
                </colgroup>
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
                  {list.map((archive) => (
                    <Archive archive={archive} key={archive.stamp} onRestore={() => setRestoring(archive)} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        {data.projects.length === 0 && <p className="mono-sm text-faint">No backup has run yet.</p>}
        <Import onDone={() => void reload()} projects={projects} />
      </WithRail>
      {restoring && (
        <ConfirmDialog
          confirmLabel="Restore"
          onClose={() => setRestoring(undefined)}
          onConfirm={() => post(`/api/backups/${restoring.project}/${restoring.stamp}/restore`).then(() => void reload())}
          title={`Restore ${restoring.project} from ${clock(stampDate(restoring.stamp).getTime())}?`}
          tone="danger"
        >
          The project stops, its databases and volumes are replaced by this archive, and it starts again. Everything written since the archive was taken is lost.
        </ConfirmDialog>
      )}
    </div>
  );
}
