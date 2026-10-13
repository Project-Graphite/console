import { ErrorState, PageHeader, TagChip, timeAgo } from '@project-graphite/ui';
import { useState } from 'react';
import { post, type Member, type Overview } from '../api';
import { usePoll } from '../usePoll';

const areas = [
  { scope: '*', label: 'everything' },
  { scope: 'area:shell', label: 'host shell' },
  { scope: 'area:images', label: 'images' },
];

function Access({ member, projects, onSaved }: { member: Member; projects: string[]; onSaved: () => void }) {
  const [scopes, setScopes] = useState(member.scopes);
  const [message, setMessage] = useState<string>();
  const changed = [...scopes].sort().join() !== [...member.scopes].sort().join();
  const everything = scopes.includes('*');
  const toggle = (scope: string) => setScopes(scopes.includes(scope) ? scopes.filter((entry) => entry !== scope) : [...scopes, scope]);
  const save = () => {
    setMessage('Saving…');
    post(`/api/admin/members/${member.login}`, { scopes }).then(
      () => {
        setMessage('Saved.');
        onSaved();
      },
      (error: Error) => setMessage(error.message),
    );
  };
  const option = (scope: string, label: string, disabled = false) => (
    <label className={`flex items-center gap-1.5 text-sm ${disabled ? 'text-faint' : ''}`} key={scope}>
      <input checked={everything || scopes.includes(scope)} disabled={disabled} onChange={() => toggle(scope)} type="checkbox" />
      {label}
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1">{areas.map((area) => option(area.scope, area.label, area.scope !== '*' && everything))}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">{projects.map((slug) => option(`project:${slug}`, slug, everything))}</div>
      <div className="flex items-center gap-3">
        <button className="secondary-button" disabled={!changed} onClick={save} type="button">
          Save
        </button>
        {message && <span className="mono-sm text-muted">{message}</span>}
      </div>
    </div>
  );
}

export function Admin() {
  const members = usePoll<Member[]>('/api/admin/members', 60_000);
  const overview = usePoll<Overview>('/api/overview', 60_000);
  if (members.error && !members.data) {
    return <ErrorState onRetry={() => void members.reload()} title="The console could not list the members">{members.error.message}</ErrorState>;
  }
  const projects = (overview.data?.projects ?? []).map((project) => project.slug);
  return (
    <div className="space-y-6">
      <PageHeader title="Admin">
        <span className="mono-sm text-muted">
          Every organisation member can read the console. Write access starts, stops and restarts a project's containers, wakes it,
          opens its terminals and ports, and takes effect at once.
        </span>
      </PageHeader>
      <div className="space-y-3">
        {(members.data ?? []).map((member) => (
          <section className="stat-card space-y-3" key={member.login}>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="mono-sm">{member.login}</span>
              {member.owner && <TagChip color="teal" label="owner" />}
              <span className="mono-sm text-faint">
                {member.seen ? `last seen ${timeAgo(new Date(member.seen).toISOString())}` : 'never signed in'}
              </span>
            </header>
            {member.owner ? (
              <p className="text-sm text-muted">Everything, as an owner.</p>
            ) : (
              <Access key={member.scopes.join()} member={member} onSaved={() => void members.reload()} projects={projects} />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
