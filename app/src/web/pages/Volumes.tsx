import MuiLink from '@mui/material/Link';
import MuiTextField from '@mui/material/TextField';
import { Button, ConfirmDialog, Dialog, ErrorState, Icon, PageHeader, TagChip, timeAgo } from '@project-graphite/ui';
import { useEffect, useState } from 'react';
import { bytes, get, post, type Disk, type Volume } from '../api';
import { ActionButton } from '../components/ActionButton';
import { Rail, WithRail } from '../components/Rail';
import { usePoll } from '../usePoll';

interface Entry {
  name: string;
  kind: 'folder' | 'file' | 'link' | 'other';
  size: number;
  modified: number;
}

function Browser({ volume, onClose }: { volume: string; onClose: () => void }) {
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState<Entry[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setEntries(undefined);
    get<Entry[]>(`/api/volumes/${volume}/files?${new URLSearchParams({ path: folder })}`).then(
      (list) => {
        setEntries(list);
        setError(undefined);
      },
      (reason: Error) => setError(reason.message),
    );
  }, [volume, folder]);
  const parts = folder.split('/').filter(Boolean);
  const join = (name: string) => [...parts, name].join('/');
  return (
    <Dialog onClose={onClose} title={volume}>
      <div className="space-y-3">
        <nav aria-label="Folder" className="mono-sm flex flex-wrap items-center gap-1 text-muted">
          <button className="hover:text-ink" onClick={() => setFolder('')} type="button">
            /
          </button>
          {parts.map((part, index) => (
            <span className="flex items-center gap-1" key={index}>
              <Icon name="chevron-right" size={12} />
              <button className="hover:text-ink" onClick={() => setFolder(parts.slice(0, index + 1).join('/'))} type="button">
                {part}
              </button>
            </span>
          ))}
        </nav>
        {error && <p className="mono-sm text-[#e5736b]">{error}</p>}
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="data-table table-fixed">
            <colgroup>
              <col className="w-[55%]" />
              <col className="w-[20%]" />
              <col className="w-[25%]" />
            </colgroup>
            <tbody>
              {(entries ?? []).map((entry) => (
                <tr key={entry.name}>
                  <td className="mono-sm truncate">
                    {entry.kind === 'folder' ? (
                      <button className="flex items-center gap-1 text-ink hover:underline" onClick={() => setFolder(join(entry.name))} type="button">
                        <Icon name="folder" size={14} />
                        {entry.name}
                      </button>
                    ) : entry.kind === 'file' ? (
                      <MuiLink className="flex items-center gap-1" href={`/api/volumes/${volume}/file?${new URLSearchParams({ path: join(entry.name) })}`} underline="hover">
                        <Icon name="file" size={14} />
                        {entry.name}
                      </MuiLink>
                    ) : (
                      <span className="flex items-center gap-1 text-muted">
                        <Icon name="link" size={14} />
                        {entry.name}
                      </span>
                    )}
                  </td>
                  <td className="mono-sm text-right text-muted">{entry.kind === 'file' ? bytes(entry.size) : ''}</td>
                  <td className="mono-sm text-right text-faint">{timeAgo(new Date(entry.modified).toISOString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries?.length === 0 && <p className="mono-sm py-2 text-faint">This folder is empty.</p>}
          {!entries && !error && <p className="mono-sm py-2 text-faint">Reading…</p>}
        </div>
      </div>
    </Dialog>
  );
}

function Create({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  return (
    <Dialog onClose={onClose} title="Create a volume">
      <div className="space-y-4">
        <MuiTextField autoFocus fullWidth label="Name" onChange={(event) => setName(event.target.value)} size="small" value={name} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} size="small" variant="text">
            Cancel
          </Button>
          <ActionButton
            disabled={!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)}
            labels={{ idle: 'Create', busy: 'Creating…', done: 'Created', failed: 'Retry' }}
            run={() => post('/api/volumes', { name }).then(onCreated)}
            variant="primary"
          />
        </div>
      </div>
    </Dialog>
  );
}

export function Volumes({ owner }: { owner: boolean }) {
  const { data, error, reload } = usePoll<Disk>('/api/disk', 60_000);
  const [browsing, setBrowsing] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Volume>();
  if (error && !data) {
    return <ErrorState title="The console could not list volumes">{error.message}</ErrorState>;
  }
  const volumes = [...(data?.volumes ?? [])].sort((a, b) => b.size - a.size);
  const largest = Math.max(1, ...volumes.map((volume) => volume.size));
  const total = volumes.reduce((sum, volume) => sum + Math.max(0, volume.size), 0);
  const unused = volumes.filter((volume) => !volume.inUse);
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          owner && (
            <Button icon="plus" onClick={() => setCreating(true)} size="small" variant="primary">
              Create
            </Button>
          )
        }
        title="Volumes"
      />
      <WithRail
        rail={
          <Rail
            stats={[
              { label: 'Volumes', value: volumes.length },
              { label: 'Total size', value: bytes(total) },
              { label: 'In use', value: volumes.length - unused.length },
              { label: 'Unused', value: unused.length ? `${unused.length} unused` : 'none', pill: unused.length ? 'yellow' : 'green', detail: unused.length ? bytes(unused.reduce((sum, volume) => sum + Math.max(0, volume.size), 0)) : undefined },
              { label: 'Largest', value: volumes[0] ? bytes(volumes[0].size) : '—', detail: volumes[0]?.name },
            ]}
            title="Storage"
          />
        }
      >
        <section className="stat-card">
          <div className="overflow-x-auto">
            <table className="data-table min-w-180 table-fixed">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[16%]" />
                <col className="w-[28%]" />
                <col className="w-[10%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>volume</th>
                  <th>project</th>
                  <th>size</th>
                  <th>status</th>
                  <th aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {volumes.map((volume) => (
                  <tr key={volume.name}>
                    <td className="mono-sm truncate" title={volume.name}>
                      {volume.project ? volume.name.replace(`${volume.project}_`, '') : volume.name}
                    </td>
                    <td className="mono-sm truncate text-muted">{volume.project ?? '—'}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded bg-line-soft">
                          <div className="h-1.5 rounded bg-muted" style={{ width: `${Math.max(1, (100 * Math.max(0, volume.size)) / largest)}%` }} />
                        </div>
                        <span className="mono-sm w-16 text-right">{volume.size >= 0 ? bytes(volume.size) : '—'}</span>
                      </div>
                    </td>
                    <td>
                      <TagChip color={volume.inUse ? 'green' : 'gray'} label={volume.inUse ? 'in use' : 'unused'} />
                    </td>
                    <td>
                      {owner && (
                        <span className="flex items-center justify-end gap-2">
                          <Button onClick={() => setBrowsing(volume.name)} size="small">
                            Browse
                          </Button>
                          {!volume.inUse && (
                            <Button icon="trash" onClick={() => setRemoving(volume)} size="small" variant="danger">
                              Delete
                            </Button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </WithRail>
      {browsing && <Browser onClose={() => setBrowsing(undefined)} volume={browsing} />}
      {creating && (
        <Create
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void reload();
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          confirmLabel="Delete"
          onClose={() => setRemoving(undefined)}
          onConfirm={() => post(`/api/volumes/${removing.name}/delete`).then(() => void reload())}
          title={`Delete ${removing.name}?`}
          tone="danger"
        >
          Its {bytes(Math.max(0, removing.size))} of data are gone for good. A nightly backup keeps it only if a container labelled it for backup.
        </ConfirmDialog>
      )}
    </div>
  );
}
