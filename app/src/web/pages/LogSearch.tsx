import MuiTextField from '@mui/material/TextField';
import { Button, PageHeader, Select } from '@project-graphite/ui';
import { useState, type FormEvent } from 'react';
import { get, type LogMatch, type Overview } from '../api';
import { Segmented } from '../components/Segmented';
import { usePoll } from '../usePoll';

const windows = ['15m', '1h', '6h', '24h', '7d'] as const;

export function LogSearch() {
  const projects = (usePoll<Overview>('/api/overview', 60_000).data?.projects ?? []).map((project) => project.slug);
  const [project, setProject] = useState('');
  const [since, setSince] = useState<(typeof windows)[number]>('1h');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ lines: LogMatch[]; more: boolean }>();
  const [message, setMessage] = useState<string>();

  const search = (event: FormEvent) => {
    event.preventDefault();
    setMessage('Searching…');
    get<{ lines: LogMatch[]; more: boolean }>(`/api/logs/search?${new URLSearchParams({ q: text, since, ...(project ? { project } : {}) })}`).then(
      (found) => {
        setResult(found);
        setMessage(undefined);
      },
      (error: Error) => setMessage(error.message),
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Logs">
        <span className="mono-sm text-muted">Search every container's logs, newest first, case-insensitively.</span>
      </PageHeader>
      <form className="stat-card flex flex-wrap items-end gap-3" onSubmit={search}>
        <MuiTextField className="w-72" label="Text" onChange={(event) => setText(event.target.value)} size="small" type="search" value={text} />
        <div className="w-48">
          <Select
            label="Project"
            onChange={setProject}
            options={[{ value: '', label: 'every project' }, ...projects.map((slug) => ({ value: slug, label: slug }))]}
            value={project}
          />
        </div>
        <Segmented label="Since" onChange={setSince} options={windows} value={since} />
        <Button type="submit" variant="primary">
          Search
        </Button>
        {message && <span className="mono-sm text-muted">{message}</span>}
      </form>
      {result && (
        <section className="stat-card space-y-2">
          <p className="mono-sm text-muted">
            {result.lines.length} lines{result.more ? ', the newest 500 shown' : ''}
          </p>
          <div className="log-frame overflow-x-auto">
            <table className="data-table">
              <tbody>
                {result.lines.map((line, index) => (
                  <tr key={`${line.container}-${line.time}-${index}`}>
                    <td className="mono-sm whitespace-nowrap text-faint">{line.time.slice(0, 19).replace('T', ' ')}</td>
                    <td className="mono-sm whitespace-nowrap text-muted">{line.container}</td>
                    <td className={`mono-sm break-all ${line.stream === 'stderr' ? 'text-[#e5736b]' : ''}`}>{line.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
