import Alert from '@mui/material/Alert';
import MuiLink from '@mui/material/Link';
import MuiTextField from '@mui/material/TextField';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  ErrorState,
  PageHeader,
  Select,
  TagChip,
  Tabs,
  TextAreaField,
  TextField,
  timeAgo,
  type SelectOption,
} from '@project-graphite/ui';
import { useEffect, useState } from 'react';
import { can, post, type Secret, type SecretDetail, type SecretProject, type SecretType, type User } from '../api';
import { Segmented } from '../components/Segmented';
import { usePoll } from '../usePoll';

const typeOptions: SelectOption<SecretType>[] = [
  { value: 'secure', label: 'Secure', hint: 'masked in the list' },
  { value: 'plain', label: 'Plain', hint: 'shown in the list, for values like a public key' },
];

const when = (at: number) => timeAgo(new Date(at).toISOString());

function Redeploy({ project, onDone }: { project: string; onDone: () => void }) {
  const [message, setMessage] = useState<string>();
  const redeploy = () => {
    setMessage('Redeploying…');
    post(`/api/secrets/${project}/redeploy`).then(
      () => {
        setMessage('Redeployed.');
        onDone();
      },
      (error: Error) => setMessage(error.message),
    );
  };
  return (
    <span className="flex items-center gap-2">
      <Button onClick={redeploy} size="small">
        Redeploy
      </Button>
      {message && <span className="mono-sm text-muted">{message}</span>}
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

export function SecretList({ project, user }: { project?: string; user: User }) {
  const { data, error, reload } = usePoll<{ projects?: SecretProject[]; project?: SecretProject; secrets: Secret[] }>(
    project ? `/api/secrets/${project}` : '/api/secrets',
    30_000,
  );
  const [prefix, setPrefix] = useState(project ? `/${project}/` : '/');
  const [filter, setFilter] = useState('');
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
  const query = filter.trim().toLowerCase();
  const rows = data.secrets.filter(
    (secret) => `/${secret.project}/${secret.name}`.startsWith(prefix) && `${secret.name} ${secret.description}`.toLowerCase().includes(query),
  );
  const groups = (data.projects ?? [data.project!]).filter(
    (entry) => rows.some((secret) => secret.project === entry.project) || (!query && `/${entry.project}/`.startsWith(prefix)),
  );
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
        {!project && (
          <MuiTextField className="w-56" label="Path prefix" onChange={(event) => setPrefix(event.target.value || '/')} size="small" value={prefix} />
        )}
        <MuiTextField className="w-56" label="Filter" onChange={(event) => setFilter(event.target.value)} size="small" type="search" value={filter} />
        <Button icon="plus" onClick={() => setCreating(true)} size="small" variant="primary">
          Create
        </Button>
        <Button disabled={!selected.length} onClick={() => void copy()} size="small">
          Copy names
        </Button>
        <Button disabled={!selected.length} onClick={() => setDeleting(true)} size="small" variant="danger">
          Delete
        </Button>
        {message && <span className="mono-sm text-muted">{message}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
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
                    <span className="mono-sm">/{entry.project}/</span>
                    {entry.needsRedeploy && <TagChip color="red" label="needs redeploy" />}
                    {entry.needsRedeploy && can(user, `project:${entry.project}`) && <Redeploy onDone={() => void reload()} project={entry.project} />}
                    {entry.missing.length > 0 && <TagChip color="red" label={`required by compose, missing: ${entry.missing.join(', ')}`} />}
                  </span>
                </td>
              </tr>
              {rows
                .filter((secret) => secret.project === entry.project)
                .map((secret) => {
                  const path = `/${secret.project}/${secret.name}`;
                  return (
                    <tr key={path}>
                      <td className="w-8">
                        <Checkbox aria-label={`Select ${path}`} checked={selected.includes(path)} onChange={() => toggle(path)} />
                      </td>
                      <td>
                        <MuiLink className="mono-sm" href={`#/secrets${path}`} underline="always">
                          {path}
                        </MuiLink>
                        {secret.value !== null && <div className="mono-sm break-all text-muted">{secret.value}</div>}
                      </td>
                      <td>
                        <TagChip color={secret.type === 'secure' ? 'gray' : 'blue'} label={secret.type} />
                      </td>
                      <td className="text-muted">{secret.description}</td>
                      <td className="mono-sm">v{secret.version}</td>
                      <td className="mono-sm whitespace-nowrap">{when(secret.updatedAt)}</td>
                      <td className="mono-sm">{secret.updatedBy}</td>
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>
      </div>
      {rows.length === 0 && <p className="mono-sm text-faint">No secret under {prefix}{query && ` matches “${filter}”`}.</p>}
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

export function Secrets({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <PageHeader title="Secrets">
        <span className="mono-sm text-muted">
          Every project's environment, encrypted in the console and written to /etc/graphite/&lt;project&gt;.env on the VPS. A project reads its file when it
          deploys.
        </span>
      </PageHeader>
      <SecretList user={user} />
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
