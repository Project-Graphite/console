import MuiTextField from '@mui/material/TextField';
import { Button, Checkbox, Icon, PageHeader, Popover, TagChip, timeAgo, type TagColor } from '@project-graphite/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bytes, get } from '../api';
import { Rail, WithRail } from '../components/Rail';
import { Segmented } from '../components/Segmented';
import { Switch } from '../components/Switch';
import { formatTime } from '../logs';
import { usePoll } from '../usePoll';

interface StoredLine {
  id: number;
  time: string;
  project: string;
  service: string;
  container: string;
  stream: 'stdout' | 'stderr';
  level: 'error' | 'warning' | 'info' | 'debug';
  text: string;
}

interface Sources {
  sources: { project: string; service: string; container: string; last: number }[];
  lines: number;
  oldest: number | null;
  errors: number;
  bytes: number;
  keepDays: number;
}

interface Filters {
  containers: string[];
  levels: string[];
  streams: string[];
  since: string;
}

const windows = ['15m', '1h', '6h', '24h', '7d'] as const;
const levelColors: Record<StoredLine['level'], TagColor> = { error: 'red', warning: 'yellow', info: 'blue', debug: 'gray' };
const levelBars: Record<StoredLine['level'], string> = { error: '#e5736b', warning: '#d7b24a', info: '#6a9eea', debug: '#8b8b95' };
const empty: Filters = { containers: [], levels: [], streams: [], since: '24h' };
const flip = (list: string[], value: string) => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

function FilterMenu({ filters, sources, onChange }: { filters: Filters; sources: Sources['sources']; onChange: (next: Filters) => void }) {
  const [open, setOpen] = useState<string[]>([]);
  const projects = [...new Set(sources.map((source) => source.project))];
  const count = filters.containers.length + filters.levels.length + filters.streams.length;
  return (
    <Popover
      label="Filter the logs"
      panelClassName="max-h-[70vh] w-80 space-y-4 overflow-y-auto p-3"
      trigger={
        <span className="flex items-center gap-1">
          <Icon name="filter" size={14} />
          {count ? `Filters Ã‚Â· ${count}` : 'Filters'}
        </span>
      }
      triggerLabel="Filters"
      triggerVariant="secondary"
    >
      {() => (
        <>
          <fieldset className="space-y-1">
            <legend className="mono-sm text-muted">Time</legend>
            <Segmented label="Time" onChange={(since) => onChange({ ...filters, since })} options={windows} value={filters.since as (typeof windows)[number]} />
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mono-sm text-muted">Source</legend>
            {projects.map((project) => {
              const containers = sources.filter((source) => source.project === project).map((source) => source.container);
              const chosen = containers.filter((name) => filters.containers.includes(name));
              const expanded = open.includes(project);
              return (
                <div key={project}>
                  <div className="flex items-center gap-1">
                    <button aria-expanded={expanded} aria-label={`Show the containers of ${project}`} className="text-muted" onClick={() => setOpen(flip(open, project))} type="button">
                      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} />
                    </button>
                    <Checkbox
                      checked={chosen.length === containers.length}
                      label={`${project}${chosen.length && chosen.length < containers.length ? ` Ã‚Â· ${chosen.length} of ${containers.length}` : ''}`}
                      onChange={() =>
                        onChange({
                          ...filters,
                          containers: chosen.length === containers.length ? filters.containers.filter((name) => !containers.includes(name)) : [...new Set([...filters.containers, ...containers])],
                        })
                      }
                    />
                  </div>
                  {expanded && (
                    <div className="ml-6 space-y-1">
                      {sources
                        .filter((source) => source.project === project)
                        .map((source) => (
                          <Checkbox
                            checked={filters.containers.includes(source.container)}
                            key={source.container}
                            label={source.service}
                            onChange={() => onChange({ ...filters, containers: flip(filters.containers, source.container) })}
                          />
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mono-sm text-muted">Level</legend>
            {(['error', 'warning', 'info', 'debug'] as const).map((level) => (
              <Checkbox checked={filters.levels.includes(level)} key={level} label={level} onChange={() => onChange({ ...filters, levels: flip(filters.levels, level) })} />
            ))}
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="mono-sm text-muted">Stream</legend>
            {['stdout', 'stderr'].map((stream) => (
              <Checkbox checked={filters.streams.includes(stream)} key={stream} label={stream} onChange={() => onChange({ ...filters, streams: flip(filters.streams, stream) })} />
            ))}
          </fieldset>
          {count > 0 && (
            <Button onClick={() => onChange({ ...empty, since: filters.since })} size="small" variant="text">
              Clear filters
            </Button>
          )}
        </>
      )}
    </Popover>
  );
}

export function LogBrowser() {
  const info = usePoll<Sources>('/api/logs/sources', 30_000).data;
  const [filters, setFilters] = useState<Filters>(empty);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(false);
  const [lines, setLines] = useState<StoredLine[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string>();
  const newest = useRef(0);

  const query = useCallback(
    (extra: Record<string, string>) =>
      `/api/logs?${new URLSearchParams({
        since: filters.since,
        ...(filters.containers.length ? { containers: filters.containers.join(',') } : {}),
        ...(filters.levels.length ? { levels: filters.levels.join(',') } : {}),
        ...(filters.streams.length ? { streams: filters.streams.join(',') } : {}),
        ...(search ? { q: search } : {}),
        ...extra,
      })}`,
    [filters, search],
  );

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    get<{ lines: StoredLine[]; more: boolean }>(query({ limit: '200' })).then(
      (page) => {
        setLines(page.lines);
        setMore(page.more);
        setError(undefined);
      },
      (reason: Error) => setError(reason.message),
    );
  }, [query]);

  useEffect(() => {
    newest.current = lines[0]?.id ?? 0;
  }, [lines]);

  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => {
      get<{ lines: StoredLine[] }>(query({ after: String(newest.current), limit: '500' })).then(
        (page) => setLines((latest) => [...page.lines.filter((line) => line.id > (latest[0]?.id ?? 0)), ...latest].slice(0, 2000)),
        (reason: Error) => setError(reason.message),
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [live, query]);

  const older = () =>
    get<{ lines: StoredLine[]; more: boolean }>(query({ before: String(lines.at(-1)!.id), limit: '200' })).then(
      (page) => {
        setLines([...lines, ...page.lines]);
        setMore(page.more);
      },
      (reason: Error) => setError(reason.message),
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Logs" />
      <WithRail
        rail={
          <Rail
            stats={[
              { label: 'Stored lines', value: info ? info.lines.toLocaleString() : 'Ã¢â‚¬â€' },
              { label: 'Errors', value: info ? info.errors.toLocaleString() : 'Ã¢â‚¬â€', pill: info?.errors ? 'red' : 'green' },
              { label: 'Sources', value: info ? info.sources.length : 'Ã¢â‚¬â€' },
              { label: 'Oldest line', value: info?.oldest ? timeAgo(new Date(info.oldest).toISOString()) : 'Ã¢â‚¬â€' },
              { label: 'Stored', value: info ? bytes(info.bytes) : 'Ã¢â‚¬â€', detail: info && `kept ${info.keepDays} days` },
              { label: 'Live tail', value: live ? 'on' : 'off', pill: live ? 'green' : 'gray' },
            ]}
            title="Store"
          />
        }
      >
        <section className="stat-card space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterMenu filters={filters} onChange={setFilters} sources={info?.sources ?? []} />
            <MuiTextField className="w-72" label="Search" onChange={(event) => setText(event.target.value)} size="small" type="search" value={text} />
            <span className="ml-auto">
              <Switch checked={live} label="Live" onChange={setLive} />
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <TagChip label={`last ${filters.since}`} />
            {filters.containers.map((name) => (
              <TagChip key={name} label={name} onRemove={() => setFilters({ ...filters, containers: flip(filters.containers, name) })} />
            ))}
            {filters.levels.map((level) => (
              <TagChip color={levelColors[level as StoredLine['level']]} key={level} label={level} onRemove={() => setFilters({ ...filters, levels: flip(filters.levels, level) })} />
            ))}
            {filters.streams.map((stream) => (
              <TagChip key={stream} label={stream} onRemove={() => setFilters({ ...filters, streams: flip(filters.streams, stream) })} />
            ))}
          </div>
          {error && <p className="mono-sm text-[#e5736b]">{error}</p>}
          <ol aria-label="Log lines" className="divide-y divide-line-soft">
            {lines.map((line) => (
              <li className="border-l-2 py-1.5 pl-3" key={line.id} style={{ borderLeftColor: levelBars[line.level] }}>
                <p className="mono-sm flex flex-wrap gap-x-2 text-faint">
                  <time dateTime={line.time}>{formatTime(line.time)}</time>
                  <span className="text-muted" title={line.container}>
                    {line.project}/{line.service}
                  </span>
                  {line.level !== 'info' && <span style={{ color: levelBars[line.level] }}>{line.level}</span>}
                  {line.stream === 'stderr' && <span>stderr</span>}
                </p>
                <p className="mono-sm break-all whitespace-pre-wrap text-ink">{line.text}</p>
              </li>
            ))}
          </ol>
          {lines.length === 0 && !error && <p className="mono-sm text-faint">No line matches.</p>}
          {more && (
            <div className="flex justify-center">
              <Button onClick={() => void older()} size="small">
                Load older
              </Button>
            </div>
          )}
        </section>
      </WithRail>
    </div>
  );
}
