import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import ListSubheader from '@mui/material/ListSubheader';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import { Icon, Popover, TagChip } from '@project-graphite/ui';
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { socketUrl } from '../api';
import { entryDetail, formatTime, levelOf, levels, segments, type Level } from '../logs';
import { usePreference } from '../stored';

interface LogLine {
  id: number;
  time: string;
  text: string;
  lower: string;
  level: Level;
}

type Status = 'loading' | 'live' | 'reconnecting' | 'stopped' | 'paused';

const keep = 5000;
const levelColors: Record<Level, { text: string; dot: string }> = {
  error: { text: 'text-danger', dot: 'bg-danger' },
  warning: { text: 'text-wip', dot: 'bg-wip' },
  debug: { text: 'text-faint', dot: 'bg-faint' },
  info: { text: 'text-indigo-300', dot: 'bg-indigo-300' },
};
const findShortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘F' : 'Ctrl+F';
const menuClass = 'w-56';

function Glyph({ path, stroke = false }: { path: string; stroke?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill={stroke ? 'none' : 'currentColor'}
      stroke={stroke ? 'currentColor' : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  );
}

function ToolButton({ active, children, disabled, label, onClick }: { active?: boolean; children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  if (active === undefined) {
    return (
      <IconButton aria-label={label} disabled={disabled} onClick={onClick} size="small" title={label}>
        {children}
      </IconButton>
    );
  }
  return (
    <ToggleButton aria-label={label} className="border-0" disabled={disabled} onChange={onClick} selected={active} size="small" title={label} value={label}>
      {children}
    </ToggleButton>
  );
}

function MenuCheck({ checked, children, onClick }: { checked: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <MenuItem aria-checked={checked} className="gap-2" dense onClick={onClick} role="menuitemcheckbox">
      {children}
      <span className="ml-auto">{checked && <Icon name="check-mark" size={14} />}</span>
    </MenuItem>
  );
}

const Row = memo(function Row({
  colors,
  line,
  needle,
  onToggle,
  open,
  textView,
  timestamps,
}: {
  colors: boolean;
  line: LogLine;
  needle: string;
  onToggle: (id: number) => void;
  open: boolean;
  textView: boolean;
  timestamps: boolean;
}) {
  const time = timestamps && line.time ? formatTime(line.time) : '';
  const message = segments(line.text, needle).map((part, index) =>
    part.match ? (
      <mark className="rounded-sm bg-wip/40 text-ink" key={index}>
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
  if (textView) {
    return (
      <div className="px-4 py-px whitespace-pre-wrap [overflow-wrap:anywhere]">
        {time && <span className="text-faint">{time} </span>}
        {message}
      </div>
    );
  }
  return (
    <div className="border-b border-line-soft">
      <div
        aria-expanded={open}
        className={`grid cursor-pointer items-start gap-x-2.5 px-4 py-2 hover:bg-line-soft ${open ? 'bg-line-soft' : ''} ${timestamps ? 'grid-cols-[4.5rem_minmax(0,1fr)] sm:grid-cols-[10.5rem_4.5rem_minmax(0,1fr)]' : 'grid-cols-[4.5rem_minmax(0,1fr)]'}`}
        onClick={() => {
          if (!window.getSelection()?.toString()) {
            onToggle(line.id);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle(line.id);
          }
        }}
        role="button"
        tabIndex={0}
      >
        {timestamps && <span className="col-span-2 text-faint sm:col-span-1">{time}</span>}
        <span className={colors ? levelColors[line.level].text : 'text-faint'}>[{line.level.toUpperCase()}]</span>
        <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message}</span>
      </div>
      {open && <pre className="mx-4 mb-2 overflow-x-auto rounded-md bg-surface p-3 text-muted">{entryDetail(line.text)}</pre>}
    </div>
  );
});

export function Logs({ collapsible = false, container, name, open = true, running }: { collapsible?: boolean; container: string; name: string; open?: boolean; running: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [streaming, setStreaming] = useState(true);
  const [reloads, setReloads] = useState(0);
  const [tail, setTail] = usePreference('console.logs.lines', 100);
  const [draft, setDraft] = useState(String(tail));
  const [timestamps, setTimestamps] = usePreference('console.logs.timestamps', true);
  const [textView, setTextView] = usePreference('console.logs.text', false);
  const [colors, setColors] = usePreference('console.logs.colors', false);
  const [shown, setShown] = usePreference<Record<Level, boolean>>('console.logs.levels', { error: true, warning: true, debug: true, info: true });
  const [query, setQuery] = useState('');
  const needle = useDeferredValue(query.trim().toLowerCase());
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [following, setFollowing] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [details, setDetails] = useState<ReadonlySet<number>>(new Set());
  const [notice, setNotice] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const followOff = useRef(false);
  const runningNow = useRef(running);
  const resume = useRef<() => void>(undefined);

  useEffect(() => {
    runningNow.current = running;
    if (running) {
      resume.current?.();
    }
  }, [running]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let flush: number | undefined;
    let pending: LogLine[] = [];
    let last = '';
    let attempts = 0;
    let next = 0;
    let disposed = false;
    setLines([]);
    setDetails(new Set());

    const connect = () => {
      resume.current = undefined;
      setStatus(attempts ? 'reconnecting' : 'loading');
      const query = last ? `after=${encodeURIComponent(last)}` : `tail=${tail}${streaming ? '' : '&follow=0'}`;
      socket = new WebSocket(socketUrl(`/ws/logs?container=${container}&${query}`));
      socket.onopen = () => {
        if (streaming) {
          setStatus('live');
        }
      };
      socket.onmessage = (event) => {
        attempts = 0;
        const text = String(event.data);
        const batch: { time: string; text: string }[] = text.startsWith('[') ? JSON.parse(text) : [{ time: '', text: text.trim() }];
        for (const line of batch) {
          const lower = line.text.toLowerCase();
          pending.push({ id: next++, time: line.time, text: line.text, lower, level: levelOf(lower) });
          last = line.time || last;
        }
        flush ??= window.setTimeout(() => {
          flush = undefined;
          const added = pending;
          pending = [];
          setLines((current) => current.concat(added).slice(-keep));
        }, 100);
      };
      socket.onclose = () => {
        if (disposed) {
          return;
        }
        if (!streaming) {
          setStatus('paused');
          return;
        }
        if (!runningNow.current) {
          setStatus('stopped');
          resume.current = connect;
          return;
        }
        setStatus('reconnecting');
        retry = window.setTimeout(connect, Math.min(15_000, 1000 * 2 ** attempts++));
      };
    };

    connect();
    return () => {
      disposed = true;
      resume.current = undefined;
      clearTimeout(retry);
      clearTimeout(flush);
      socket?.close();
    };
  }, [container, tail, streaming, expanded, reloads]);

  const visible = useMemo(() => lines.filter((line) => shown[line.level] && (!needle || line.lower.includes(needle))), [lines, shown, needle]);

  useLayoutEffect(() => {
    if (following && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [visible, following, timestamps, textView, fullscreen, details]);

  useEffect(() => {
    const owns = () => {
      const active = document.activeElement;
      if (!expanded || active === search.current) {
        return false;
      }
      if (root.current?.contains(active)) {
        return true;
      }
      if (active?.closest('[data-logs]') || active?.matches('input, textarea, select, [contenteditable="true"]')) {
        return false;
      }
      return (document.querySelector('[data-logs="fullscreen"]') ?? document.querySelector('[data-logs="expanded"]')) === root.current;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && fullscreen) {
        setFullscreen(false);
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f' && owns()) {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, fullscreen]);

  const toggleDetail = useCallback(
    (id: number) =>
      setDetails((current) => {
        const updated = new Set(current);
        if (!updated.delete(id)) {
          updated.add(id);
        }
        return updated;
      }),
    [],
  );

  const flash = (message: string) => {
    setNotice(message);
    setTimeout(() => setNotice(undefined), 2500);
  };

  const displayed = () => visible.map((line) => (timestamps && line.time ? `${formatTime(line.time)} ${line.text}` : line.text)).join('\n');

  const downloadDisplayed = () => {
    const href = URL.createObjectURL(new Blob([`${displayed()}\n`], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = href;
    link.download = `${name}-logs-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href));
  };

  const applyLines = () => {
    const value = Math.min(Math.max(Math.trunc(Number(draft)) || 100, 1), keep);
    setDraft(String(value));
    setTail(value);
  };

  const panel = (
    <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-paper' : collapsible ? '' : 'rounded-xl border border-line bg-surface'}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-2 py-1.5">
        <div className="flex items-center gap-1">
          <ToolButton active={streaming} label={streaming ? 'Stop streaming' : 'Stream logs'} onClick={() => setStreaming(!streaming)}>
            <Glyph path={streaming ? 'M6 4h4v16H6V4zm8 0h4v16h-4V4z' : 'M8 5v14l11-7L8 5z'} />
          </ToolButton>
          <ToolButton disabled={streaming} label="Refresh logs" onClick={() => setReloads(reloads + 1)}>
            <Icon name="refresh" size={14} />
          </ToolButton>
          <ToolButton
            active={following}
            label="Follow logs"
            onClick={() => {
              followOff.current = following;
              setFollowing(!following);
            }}
          >
            <Glyph path="M12 5v14m4-4l-4 4m-4-4l4 4" stroke />
          </ToolButton>
          <ToolButton label={fullscreen ? 'Minimize' : 'Fullscreen'} onClick={() => setFullscreen(!fullscreen)}>
            <Glyph path={fullscreen ? 'M6 14h4m0 0v4m0-4l-6 6m14-10h-4m0 0V6m0 4l6-6' : 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7'} stroke />
          </ToolButton>
          <span className="ml-1">
            <TagChip
              color={({ loading: 'gray', live: 'green', reconnecting: 'yellow', stopped: 'gray', paused: 'blue' } as const)[status]}
              label={status}
            />
          </span>
          {notice && <span className="mono-sm text-muted">{notice}</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyLines();
            }}
          >
            <TextField
              className="w-28"
              label="Lines"
              onBlur={applyLines}
              onChange={(event) => setDraft(event.target.value)}
              size="small"
              slotProps={{ htmlInput: { 'aria-label': 'Number of lines', max: keep, min: 1, title: `Number of lines (max ${keep.toLocaleString()})` } }}
              type="number"
              value={draft}
            />
          </form>
          <TextField
            className="w-56"
            inputRef={search}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('');
              }
            }}
            placeholder="Find in logs"
            size="small"
            slotProps={{
              htmlInput: { 'aria-keyshortcuts': findShortcut === '⌘F' ? 'Meta+F' : 'Control+F', 'aria-label': 'Find in logs' },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {query ? (
                      <IconButton aria-label="Clear search" edge="end" onClick={() => setQuery('')} size="small">
                        <Icon name="x" size={12} />
                      </IconButton>
                    ) : (
                      <kbd className="rounded border border-line px-1 font-sans text-[10px] text-faint">{findShortcut}</kbd>
                    )}
                  </InputAdornment>
                ),
                startAdornment: (
                  <InputAdornment position="start">
                    <Icon name="search" size={14} />
                  </InputAdornment>
                ),
              },
            }}
            value={query}
          />
          <Popover
            label="View options"
            panelClassName={menuClass}
            trigger={
              <span className="inline-flex items-center gap-1.5">
                <Icon name="settings" size={14} /> View <Icon name="chevron-down" size={12} />
              </span>
            }
            triggerClassName={levels.some((level) => !shown[level]) ? 'border-ink text-ink' : undefined}
            triggerLabel="View options"
            triggerVariant="secondary"
          >
            {() => (
              <MenuList dense>
                <ListSubheader className="bg-transparent leading-8">Display</ListSubheader>
                <MenuCheck checked={timestamps} onClick={() => setTimestamps(!timestamps)}>
                  Timestamps
                </MenuCheck>
                <MenuCheck checked={textView} onClick={() => setTextView(!textView)}>
                  Text view
                </MenuCheck>
                <MenuCheck checked={colors} onClick={() => setColors(!colors)}>
                  Color by level
                </MenuCheck>
                <ListSubheader className="bg-transparent leading-8">Log levels</ListSubheader>
                {levels.map((level) => (
                  <MenuCheck checked={shown[level]} key={level} onClick={() => setShown({ ...shown, [level]: !shown[level] })}>
                    <span className={`size-2.5 rounded-full ${levelColors[level].dot}`} />
                    <span className="capitalize">{level}</span>
                  </MenuCheck>
                ))}
              </MenuList>
            )}
          </Popover>
          <Popover
            label="Copy or download logs"
            panelClassName={menuClass}
            trigger={
              <span className="inline-flex items-center gap-1.5">
                <Icon name="download" size={14} /> Export <Icon name="chevron-down" size={12} />
              </span>
            }
            triggerLabel="Copy or download logs"
            triggerVariant="secondary"
          >
            {(close) => (
              <MenuList dense>
                <MenuItem
                  onClick={() => {
                    close();
                    navigator.clipboard.writeText(displayed()).then(
                      () => flash('Logs copied.'),
                      () => flash('The browser refused clipboard access.'),
                    );
                  }}
                >
                  Copy logs
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    close();
                    downloadDisplayed();
                  }}
                >
                  Download displayed logs
                </MenuItem>
                <MenuItem component="a" download href={`/api/containers/${container}/logs`} onClick={close}>
                  Download all logs
                </MenuItem>
              </MenuList>
            )}
          </Popover>
        </div>
      </div>
      <div
        className={`overflow-y-auto bg-black font-mono text-xs leading-relaxed text-ink ${fullscreen ? 'flex-1' : 'max-h-[min(40rem,70dvh)] min-h-72 rounded-b-xl'}`}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 10;
          if (!atBottom) {
            setFollowing(false);
          } else if (!followOff.current) {
            setFollowing(true);
          }
        }}
        ref={viewport}
        tabIndex={0}
      >
        {visible.length > 0 && !textView && (
          <div
            className={`sticky top-0 z-10 hidden gap-x-2.5 border-b border-line bg-surface px-4 py-2 font-sans text-muted sm:grid ${timestamps ? 'grid-cols-[10.5rem_4.5rem_minmax(0,1fr)]' : 'grid-cols-[4.5rem_minmax(0,1fr)]'}`}
          >
            {timestamps && <span>Time</span>}
            <span>Type</span>
            <span>Message</span>
          </div>
        )}
        {visible.map((line) => (
          <Row colors={colors} key={line.id} line={line} needle={needle} onToggle={toggleDetail} open={details.has(line.id)} textView={textView} timestamps={timestamps} />
        ))}
        {visible.length === 0 && (
          <div className="flex h-full min-h-60 flex-col items-center justify-center gap-1 p-6 text-center font-sans">
            {lines.length ? (
              <p className="text-muted">No matches found.</p>
            ) : status === 'loading' ? (
              <p className="text-muted">Loading logs…</p>
            ) : (
              <>
                <p className="text-ink">No logs yet</p>
                <p className="text-sm text-faint">
                  {status === 'stopped' ? 'The container is stopped. Logs resume when it starts.' : 'Logs will appear here when the container produces output.'}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div data-logs={fullscreen ? 'fullscreen' : expanded ? 'expanded' : 'collapsed'} ref={root}>
      {collapsible ? (
        <div className="rounded-xl border border-line bg-surface">
          <ButtonBase aria-expanded={expanded} className="flex w-full items-center justify-start gap-2 px-3.5 py-2.5 text-left hover:bg-line-soft" onClick={() => setExpanded(!expanded)}>
            <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>
              <Icon name="chevron-right" size={14} />
            </span>
            <span className="mono-sm truncate">{name}</span>
            {expanded && status === 'live' && <span className="size-1.5 animate-pulse rounded-full bg-live" />}
          </ButtonBase>
          {expanded && <div className="border-t border-line">{panel}</div>}
        </div>
      ) : (
        panel
      )}
    </div>
  );
}
