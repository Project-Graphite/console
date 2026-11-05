import Alert from '@mui/material/Alert';
import MuiIconButton from '@mui/material/IconButton';
import MuiLink from '@mui/material/Link';
import Tooltip from '@mui/material/Tooltip';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Icon,
  PageHeader,
  Popover,
  Select,
  TagChip,
  Tabs,
  TextAreaField,
  TextField,
  timeAgo,
  type SelectOption,
} from '@project-graphite/ui';
import { useEffect, useState } from 'react';
import { post, type Secret, type SecretDetail, type SecretProject, type SecretType, type User } from '../api';
import { Segmented } from '../components/Segmented';
import { usePoll } from '../usePoll';

const typeOptions: SelectOption<SecretType>[] = [
  { value: 'secure', label: 'Secure', hint: 'masked in the list' },
  { value: 'plain', label: 'Plain', hint: 'shown in the list, for values like a public key' },
];

const when = (at: number) => timeAgo(new Date(at).toISOString());

interface Filters {
  projects: string[];
  types: SecretType[];
  attention: boolean;
}

const active = (filters: Filters) => filters.projects.length + filters.types.length + Number(filters.attention);

function CopyGlyph() {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="16">
      <rect height="13" rx="2" width="13" x="9" y="9" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function SecretFilters({ filters, projects, onChange }: { filters: Filters; projects: string[]; onChange: (next: Filters) => void }) {
  const flip = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  const count = active(filters);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Popover label="Filter the secrets" panelClassName="w-64 space-y-3 p-3" trigger={count ? `Filters · ${count}` : 'Filters'} triggerLabel="Filters" triggerVariant="secondary">
        {() => (
          <>
            {projects.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="mono-sm text-muted">Project</legend>
                {projects.map((slug) => (
                  <Checkbox checked={filters.projects.includes(slug)} key={slug} label={slug} onChange={() => onChange({ ...filters, projects: flip(filters.projects, slug) })} />
                ))}
              </fieldset>
            )}
            <fieldset className="space-y-1">
              <legend className="mono-sm text-muted">Type</legend>
              {typeOptions.map((option) => (
                <Checkbox
                  checked={filters.types.includes(option.value)}
                  key={option.value}
                  label={option.label}
                  onChange={() => onChange({ ...filters, types: flip(filters.types, option.value) })}
                />
              ))}
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="mono-sm text-muted">Status</legend>
              <Checkbox checked={filters.attention} label="Missing a required secret" onChange={() => onChange({ ...filters, attention: !filters.attention })} />
            </fieldset>
            {count > 0 && (
              <Button onClick={() => onChange({ projects: [], types: [], attention: false })} size="small" variant="text">
                Clear filters
              </Button>
            )}
          </>
        )}
      </Popover>
      {filters.projects.map((slug) => (
        <TagChip key={slug} label={slug} onRemove={() => onChange({ ...filters, projects: flip(filters.projects, slug) })} />
      ))}
      {filters.types.map((type) => (
        <TagChip key={type} label={type} onRemove={() => onChange({ ...filters, types: flip(filters.types, type) })} />
      ))}
      {filters.attention && <TagChip label="missing a secret" onRemove={() => onChange({ ...filters, attention: false })} />}
    </span>
  );
}

function SecretSheet({ prefix, secret, onClose, onSaved }: { prefix: string; secret?: Secret; onClose: () => void; onSaved: () => void }) {
  const [mode, setMode] = useState<'Create' | 'Import'>('Create');
  const [path, setPath] = useState(secret ? `/${secret.project}/${secret.name}` : prefix);
  const [description, setDescription] = useState(secret?.description ?? '');
  const [type, setType] = useState<SecretType>(secret?.type ?? 'secure');
  const [value, setValue] = useState('');
  const [lines, setLines] = useState('');
  const [names, setNames] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const target = /^\/([a-z0-9-]+)\/([A-Z_][A-Z0-9_]*)?$/.exec(path);

  const send = <T,>(url: string, body: unknown, after: (result: T) => void) => {
    setBusy(true);
    setError(undefined);
    post<T>(url, body)
      .then(after, (reason: Error) => setError(reason.message))
      .finally(() => setBusy(false));
  };
  const save = () => {
    if (secret) {
      send(`/api/secrets/${secret.project}/${secret.name}`, { description, type, value: value || undefined }, onSaved);
    } else if (target?.[2]) {
      send(`/api/secrets/${target[1]}`, { name: target[2], description, type, value }, onSaved);
    } else {
      setError('A name is /<project>/<NAME>, the last segment in capitals, digits and underscores.');
    }
  };
  const importLines = (preview: boolean) => {
    if (!target) {
      setError('The path is /<project>/.');
      return;
    }
    send<{ names: string[] }>(`/api/secrets/${target[1]}/import`, { text: lines, preview }, (result) => (preview ? setNames(result.names) : onSaved()));
  };

  return (
    <Dialog onClose={onClose} title={secret ? `Edit /${secret.project}/${secret.name}` : 'Create a secret'}>
      <div className="space-y-3">
        {!secret && <Segmented label="Create or import" onChange={setMode} options={['Create', 'Import'] as const} value={mode} />}
        <TextField
          disabled={Boolean(secret)}
          hint={mode === 'Create' ? '/<project>/<NAME>' : '/<project>/'}
          label={mode === 'Create' ? 'Name' : 'Path'}
          onChange={(event) => {
            setPath(event.target.value);
            setNames(undefined);
          }}
          value={path}
        />
        {mode === 'Create' ? (
          <>
            <TextField label="Description" onChange={(event) => setDescription(event.target.value)} value={description} />
            <Select label="Type" onChange={setType} options={typeOptions} value={type} />
            <TextAreaField
              hint={secret ? 'Leave empty to keep the current value.' : undefined}
              label="Value"
              onChange={(event) => setValue(event.target.value)}
              rows={4}
              value={value}
            />
            <Button disabled={busy} onClick={save} variant="primary">
              {secret ? 'Save' : 'Create'}
            </Button>
          </>
        ) : (
          <>
            <TextAreaField
              hint="NAME=value lines, as in an env file"
              label="Lines"
              onChange={(event) => {
                setLines(event.target.value);
                setNames(undefined);
              }}
              rows={8}
              value={lines}
            />
            {names && target && <p className="mono-sm break-all">Creates {names.map((name) => `/${target[1]}/${name}`).join(', ')}</p>}
            <Button disabled={busy} onClick={() => importLines(!names)} variant="primary">
              {names ? `Create ${names.length} secrets` : 'Review'}
            </Button>
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </div>
    </Dialog>
  );
}

export function SecretList({ project }: { project?: string }) {
  const { data, error, reload } = usePoll<{ projects?: SecretProject[]; project?: SecretProject; secrets: Secret[] }>(
    project ? `/api/secrets/${project}` : '/api/secrets',
    30_000,
  );
  const [filters, setFilters] = useState<Filters>({ projects: [], types: [], attention: false });
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string>();
  if (error && !data) {
    return <ErrorState onRetry={() => void reload()} title="The console could not read the secrets">{error.message}</ErrorState>;
  }
  if (!data) {
    return null;
  }
  const all = data.projects ?? [data.project!];
  const groups = all.filter(
    (entry) =>
      (!filters.projects.length || filters.projects.includes(entry.project)) &&
      (!filters.attention || entry.missing.length > 0) &&
      (!filters.types.length || data.secrets.some((secret) => secret.project === entry.project && filters.types.includes(secret.type))),
  );
  const rows = data.secrets.filter(
    (secret) => groups.some((entry) => entry.project === secret.project) && (!filters.types.length || filters.types.includes(secret.type)),
  );
  const prefix = project ? `/${project}/` : filters.projects.length === 1 ? `/${filters.projects[0]}/` : '/';
  const toggle = (path: string) => setSelected(selected.includes(path) ? selected.filter((entry) => entry !== path) : [...selected, path]);
  const copy = () =>
    navigator.clipboard.writeText(selected.join('\n')).then(
      () => setMessage(`Copied ${selected.length} names.`),
      (reason: Error) => setMessage(reason.message),
    );
  const remove = async () => {
    for (const slug of new Set(selected.map((path) => path.split('/')[1]))) {
      await post(`/api/secrets/${slug}/delete`, { names: selected.filter((path) => path.startsWith(`/${slug}/`)).map((path) => path.split('/')[2]) });
    }
    setSelected([]);
    void reload();
  };

  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SecretFilters filters={filters} onChange={setFilters} projects={project ? [] : all.map((entry) => entry.project)} />
        {message && <span className="mono-sm text-muted">{message}</span>}
        <span className="ml-auto flex items-center gap-2">
          <Tooltip title="Copy the selected names">
            <span>
              <MuiIconButton aria-label="Copy the selected names" disabled={!selected.length} onClick={() => void copy()} size="small">
                <CopyGlyph />
              </MuiIconButton>
            </span>
          </Tooltip>
          <Button disabled={!selected.length} onClick={() => setDeleting(true)} size="small" variant="danger">
            Delete
          </Button>
          <Button icon="plus" onClick={() => setCreating(true)} size="small" variant="primary">
            Create
          </Button>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table min-w-180 table-fixed">
          <colgroup>
            <col className="w-12" />
            <col className="w-[30%]" />
            <col className="w-[9%]" />
            <col />
            <col className="w-[8%]" />
            <col className="w-[13%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead>
            <tr>
              <th aria-label="selected" />
              <th>name</th>
              <th>type</th>
              <th>description</th>
              <th>version</th>
              <th>last modified</th>
              <th>modified by</th>
            </tr>
          </thead>
          {groups.map((entry) => (
            <tbody key={entry.project}>
              <tr>
                <td colSpan={7}>
                  <span className="flex flex-wrap items-center gap-2">
                    <button
                      aria-expanded={!collapsed.includes(entry.project)}
                      className="mono-sm flex items-center gap-1 text-ink"
                      onClick={() => setCollapsed(collapsed.includes(entry.project) ? collapsed.filter((slug) => slug !== entry.project) : [...collapsed, entry.project])}
                      type="button"
                    >
                      <Icon name={collapsed.includes(entry.project) ? 'chevron-right' : 'chevron-down'} size={14} />/{entry.project}/
                      <span className="text-faint">· {rows.filter((secret) => secret.project === entry.project).length}</span>
                    </button>
                    {entry.missing.length > 0 && <TagChip color="red" label={`required by compose, missing: ${entry.missing.join(', ')}`} />}
                  </span>
                </td>
              </tr>
              {rows
                .filter((secret) => secret.project === entry.project && !collapsed.includes(entry.project))
                .map((secret) => {
                  const path = `/${secret.project}/${secret.name}`;
                  return (
                    <tr key={path}>
                      <td className="w-8">
                        <Checkbox aria-label={`Select ${path}`} checked={selected.includes(path)} onChange={() => toggle(path)} />
                      </td>
                      <td>
                        <MuiLink className="mono-sm break-all" href={`#/secrets${path}`} underline="always">
                          {path}
                        </MuiLink>
                        {secret.value !== null && <div className="mono-sm break-all text-muted">{secret.value}</div>}
                      </td>
                      <td>
                        <TagChip color={secret.type === 'secure' ? 'gray' : 'blue'} label={secret.type} />
                      </td>
                      <td className="truncate text-muted" title={secret.description}>
                        {secret.description}
                      </td>
                      <td className="mono-sm">v{secret.version}</td>
                      <td className="mono-sm whitespace-nowrap">{when(secret.updatedAt)}</td>
                      <td className="mono-sm truncate" title={secret.updatedBy}>
                        {secret.updatedBy}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>
      </div>
      {rows.length === 0 && <p className="mono-sm text-faint">{active(filters) ? 'No secret matches these filters.' : 'No secret yet.'}</p>}
      {creating && (
        <SecretSheet
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            void reload();
          }}
          prefix={prefix}
        />
      )}
      {deleting && (
        <ConfirmDialog confirmLabel="Delete" onClose={() => setDeleting(false)} onConfirm={remove} title={`Delete ${selected.length} secrets?`} tone="danger">
          {selected.join(', ')} leave the store and the project's env file. A running project keeps its values until it redeploys.
        </ConfirmDialog>
      )}
    </section>
  );
}

export function Secrets() {
  return (
    <div className="space-y-6">
      <PageHeader title="Secrets">
        <span className="mono-sm text-muted">
          Every project's environment, encrypted in the console and written to /etc/graphite/&lt;project&gt;.env on the VPS. A project reads its file when it
          deploys.
        </span>
      </PageHeader>
      <SecretList />
    </div>
  );
}

function Reveal({ secret }: { secret: SecretDetail }) {
  const [value, setValue] = useState(secret.value);
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    if (secret.type === 'plain' || value === null) {
      return;
    }
    const timer = setTimeout(() => setValue(null), 30_000);
    return () => clearTimeout(timer);
  }, [secret.type, value]);
  const reveal = () => post<{ value: string }>(`/api/secrets/${secret.project}/${secret.name}/reveal`).then((result) => result.value);
  const show = () => reveal().then(setValue, (error: Error) => setMessage(error.message));
  const copy = () =>
    (value === null ? reveal() : Promise.resolve(value))
      .then((text) => navigator.clipboard.writeText(text))
      .then(
        () => setMessage('Copied.'),
        (error: Error) => setMessage(error.message),
      );
  return (
    <section className="stat-card space-y-3">
      <pre className="mono-sm whitespace-pre-wrap break-all">{value ?? '••••••••••••'}</pre>
      <div className="flex items-center gap-2">
        {value === null && (
          <Button onClick={() => void show()} size="small">
            Reveal for 30 seconds
          </Button>
        )}
        <Button onClick={() => void copy()} size="small">
          Copy
        </Button>
        {message && <span className="mono-sm text-muted">{message}</span>}
      </div>
    </section>
  );
}

function History({ secret, onRestored }: { secret: SecretDetail; onRestored: () => void }) {
  const [message, setMessage] = useState<string>();
  const restore = (version: number) =>
    post(`/api/secrets/${secret.project}/${secret.name}/restore`, { version }).then(onRestored, (error: Error) => setMessage(error.message));
  return (
    <section className="stat-card space-y-2">
      <table className="data-table">
        <thead>
          <tr>
            <th>version</th>
            <th>length</th>
            <th>by</th>
            <th>when</th>
            <th aria-label="restore" />
          </tr>
        </thead>
        <tbody>
          {secret.history.map((entry, index) => {
            const change = index + 1 < secret.history.length ? entry.length - secret.history[index + 1].length : null;
            return (
              <tr key={entry.version}>
                <td className="mono-sm">v{entry.version}</td>
                <td className="mono-sm">
                  {entry.length}
                  {change ? <span className="text-faint"> ({change > 0 ? `+${change}` : change})</span> : null}
                </td>
                <td className="mono-sm">{entry.updatedBy}</td>
                <td className="mono-sm whitespace-nowrap">{when(entry.updatedAt)}</td>
                <td>
                  {entry.version !== secret.version && (
                    <Button onClick={() => void restore(entry.version)} size="small">
                      Restore
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {message && <p className="mono-sm text-muted">{message}</p>}
    </section>
  );
}

export function SecretPage({ project, name, tab, user }: { project: string; name: string; tab: string; user: User }) {
  const base = `#/secrets/${project}/${name}`;
  const { data: secret, error, reload } = usePoll<SecretDetail>(`/api/secrets/${project}/${name}`, 30_000);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (error && !secret) {
    return <ErrorState title={`The console could not read /${project}/${name}`}>{error.message}</ErrorState>;
  }
  if (!secret) {
    return null;
  }
  const back = user.owner ? '#/secrets' : `#/project/${project}`;
  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <span className="flex gap-2">
            <Button icon="pencil" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button icon="trash" onClick={() => setDeleting(true)} variant="danger">
              Delete
            </Button>
          </span>
        }
        eyebrow={
          <MuiLink href={back} underline="always">
            {user.owner ? 'Secrets' : project}
          </MuiLink>
        }
        title={`/${project}/${name}`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <TagChip color={secret.type === 'secure' ? 'gray' : 'blue'} label={secret.type} />
          <TagChip label={`v${secret.version}`} />
          <span className="text-sm text-muted">{secret.description}</span>
        </span>
      </PageHeader>
      <Tabs
        items={[
          { href: base, label: 'Overview', active: tab === '' },
          { href: `${base}/history`, label: 'History', active: tab === 'history' },
          { href: `${base}/usage`, label: 'Usage', active: tab === 'usage' },
        ]}
        label="Secret"
      />
      {tab === '' && <Reveal key={secret.version} secret={secret} />}
      {tab === 'history' && <History onRestored={() => void reload()} secret={secret} />}
      {tab === 'usage' && (
        <section className="stat-card">
          <p className="mono-sm">
            {secret.usage.length
              ? `${secret.file} references ${name} on line ${secret.usage.join(', ')}.`
              : `The compose file the agent last applied for ${project} does not reference ${name}.`}
          </p>
        </section>
      )}
      {editing && (
        <SecretSheet
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
          prefix=""
          secret={secret}
        />
      )}
      {deleting && (
        <ConfirmDialog
          confirmLabel="Delete"
          onClose={() => setDeleting(false)}
          onConfirm={() => post(`/api/secrets/${project}/delete`, { names: [name] }).then(() => location.assign(back))}
          title={`Delete /${project}/${name}?`}
          tone="danger"
        >
          It leaves the store and the project's env file, with its history. A running project keeps the value until it redeploys.
        </ConfirmDialog>
      )}
    </div>
  );
}
