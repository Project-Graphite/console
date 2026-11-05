import MuiTextField from '@mui/material/TextField';
import { Button, Dialog, ErrorState, PageHeader, TagChip, timeAgo, Toggle } from '@project-graphite/ui';
import { useState } from 'react';
import { post, type Member, type Overview } from '../api';
import { ActionButton } from '../components/ActionButton';
import { Rail, WithRail } from '../components/Rail';
import { usePoll } from '../usePoll';

const areas = [
  { scope: '*', label: 'Everything', detail: 'every project, the host shell and images; secrets still need their own grant' },
  { scope: 'area:shell', label: 'Host shell', detail: 'a root shell on the VPS' },
  { scope: 'area:images', label: 'Images', detail: 'remove unused images' },
];

function summary(scopes: string[]) {
  const projects = scopes.filter((scope) => scope.startsWith('project:')).length;
  const secrets = scopes.filter((scope) => scope.startsWith('secrets:')).length;
  return [
    ...(scopes.includes('*') ? ['everything'] : []),
    ...(scopes.includes('area:shell') ? ['host shell'] : []),
    ...(scopes.includes('area:images') ? ['images'] : []),
    ...(projects && !scopes.includes('*') ? [`${projects} project${projects > 1 ? 's' : ''}`] : []),
    ...(secrets ? [`secrets of ${secrets}`] : []),
  ];
}

function AccessDialog({ member, projects, onClose, onSaved }: { member: Member; projects: string[]; onClose: () => void; onSaved: () => void }) {
  const [scopes, setScopes] = useState(member.scopes);
  const [filter, setFilter] = useState('');
  const changed = [...scopes].sort().join() !== [...member.scopes].sort().join();
  const everything = scopes.includes('*');
  const set = (scope: string, on: boolean) => setScopes(on ? [...new Set([...scopes, scope])] : scopes.filter((entry) => entry !== scope));
  const shown = projects.filter((slug) => slug.includes(filter.trim().toLowerCase()));
  return (
    <Dialog onClose={onClose} title={`Access for ${member.login}`}>
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="mono-sm text-muted">Areas</h3>
          {areas.map((area) => (
            <Toggle
              checked={everything || scopes.includes(area.scope)}
              description={area.detail}
              disabled={area.scope !== '*' && everything}
              key={area.scope}
              label={area.label}
              onChange={(on) => set(area.scope, on)}
            />
          ))}
        </section>
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="mono-sm text-muted">Projects</h3>
            <MuiTextField className="w-48" label="Find a project" onChange={(event) => setFilter(event.target.value)} size="small" type="search" value={filter} />
          </div>
          <div className="max-h-80 overflow-y-auto">
            <table className="data-table table-fixed">
              <colgroup>
                <col className="w-[50%]" />
                <col className="w-[25%]" />
                <col className="w-[25%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>project</th>
                  <th>operate</th>
                  <th>secrets</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((slug) => (
                  <tr key={slug}>
                    <td className="mono-sm truncate">{slug}</td>
                    <td>
                      <Toggle checked={everything || scopes.includes(`project:${slug}`)} disabled={everything} label={`Operate ${slug}`} onChange={(on) => set(`project:${slug}`, on)} />
                    </td>
                    <td>
                      <Toggle checked={scopes.includes(`secrets:${slug}`)} label={`Secrets of ${slug}`} onChange={(on) => set(`secrets:${slug}`, on)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="mono-sm py-2 text-faint">No project matches.</p>}
          </div>
        </section>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} size="small" variant="text">
            Close
          </Button>
          <ActionButton
            disabled={!changed}
            labels={{ idle: 'Save', busy: 'Saving…', done: 'Saved', failed: 'Retry' }}
            run={() => post(`/api/admin/members/${member.login}`, { scopes }).then(onSaved)}
            variant="primary"
          />
        </div>
      </div>
    </Dialog>
  );
}

export function Admin() {
  const members = usePoll<Member[]>('/api/admin/members', 60_000);
  const overview = usePoll<Overview>('/api/overview', 60_000);
  const [editing, setEditing] = useState<string>();
  if (members.error && !members.data) {
    return <ErrorState onRetry={() => void members.reload()} title="The console could not list the members">{members.error.message}</ErrorState>;
  }
  const projects = (overview.data?.projects ?? []).map((project) => project.slug);
  const list = members.data ?? [];
  const member = list.find((entry) => entry.login === editing);
  const week = Date.now() - 7 * 86_400_000;
  return (
    <div className="space-y-6">
      <PageHeader title="Admin" />
      <WithRail
        rail={
          <Rail
            stats={[
              { label: 'Members', value: list.length },
              { label: 'Owners', value: list.filter((entry) => entry.owner).length },
              { label: 'With write access', value: list.filter((entry) => !entry.owner && entry.scopes.length).length },
              { label: 'Seen this week', value: list.filter((entry) => (entry.seen ?? 0) > week).length },
              { label: 'Never signed in', value: list.filter((entry) => !entry.seen).length },
            ]}
            title="Members"
          />
        }
      >
        <section className="stat-card">
          <div className="overflow-x-auto">
            <table className="data-table min-w-180 table-fixed">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-[18%]" />
                <col className="w-[30%]" />
                <col className="w-[14%]" />
              </colgroup>
              <thead>
                <tr>
                  <th>member</th>
                  <th>role</th>
                  <th>last seen</th>
                  <th>access</th>
                  <th aria-label="edit" />
                </tr>
              </thead>
              <tbody>
                {list.map((entry) => (
                  <tr key={entry.login}>
                    <td className="mono-sm truncate">{entry.login}</td>
                    <td>
                      <TagChip color={entry.owner ? 'teal' : 'gray'} label={entry.owner ? 'owner' : 'member'} />
                    </td>
                    <td className="mono-sm text-muted">{entry.seen ? timeAgo(new Date(entry.seen).toISOString()) : 'never'}</td>
                    <td>
                      <span className="flex flex-wrap gap-1">
                        {entry.owner ? (
                          <TagChip color="teal" label="everything" />
                        ) : summary(entry.scopes).length ? (
                          summary(entry.scopes).map((label) => <TagChip color="blue" key={label} label={label} />)
                        ) : (
                          <TagChip label="read only" />
                        )}
                      </span>
                    </td>
                    <td className="text-right">
                      {!entry.owner && (
                        <Button icon="pencil" onClick={() => setEditing(entry.login)} size="small">
                          Edit
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </WithRail>
      {member && <AccessDialog key={member.login} member={member} onClose={() => setEditing(undefined)} onSaved={() => void members.reload()} projects={projects} />}
    </div>
  );
}
