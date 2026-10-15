import { TagChip } from '@project-graphite/ui';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { socketUrl } from '../api';
import { load, save } from '../stored';
import { Pill, Segmented } from './Segmented';

interface LogLine {
  id: number;
  stream: 'stdout' | 'stderr';
  time: string;
  text: string;
}

type Status = 'connecting' | 'live' | 'reconnecting' | 'stopped';

const keep = 5000;
const tails = [100, 300, 1000, 5000];
const streams = ['all', 'stdout', 'stderr'] as const;
const clock = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});

const Row = memo(function Row({ line, timestamps }: { line: LogLine; timestamps: boolean }) {
  return (
    <div className={`border-l-2 pl-2 ${line.stream === 'stderr' ? 'border-danger/60' : 'border-transparent'}`}>
      {timestamps && line.time && <span className="text-faint select-none">{clock.format(new Date(line.time))} </span>}
      {line.text || ' '}
    </div>
  );
});

export function Logs({ container, name, running }: { container: string; name: string; running: boolean }) {
  const [tail, setTail] = useState(() => {
    const saved = load('console.logs.tail', 300);
    return tails.includes(saved) ? saved : 300;
  });
  const [timestamps, setTimestamps] = useState(() => load('console.logs.timestamps', false));
  const [wrap, setWrap] = useState(() => load('console.logs.wrap', true));
  const [stream, setStream] = useState<(typeof streams)[number]>('all');
  const [filter, setFilter] = useState('');
  const [lines, setLines] = useState<LogLine[]>([]);
  const [frozen, setFrozen] = useState<LogLine[]>();
  const [status, setStatus] = useState<Status>('connecting');
  const [following, setFollowing] = useState(true);
  const frame = useRef<HTMLDivElement>(null);
  const runningNow = useRef(running);
  const resume = useRef<() => void>(undefined);

  useEffect(() => {
    runningNow.current = running;
    if (running) {
      resume.current?.();
    }
  }, [running]);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retry: number | undefined;
    let flush: number | undefined;
    let pending: LogLine[] = [];
    let last = '';
    let attempts = 0;
    let next = 0;
    let disposed = false;
    setLines([]);
    setFrozen(undefined);

    const connect = () => {
      resume.current = undefined;
      setStatus(attempts ? 'reconnecting' : 'connecting');
      socket = new WebSocket(socketUrl(`/ws/logs?container=${container}&${last ? `after=${encodeURIComponent(last)}` : `tail=${tail}`}`));
      socket.onopen = () => setStatus('live');
      socket.onmessage = (event) => {
        attempts = 0;
        const text = String(event.data);
        const batch: Omit<LogLine, 'id'>[] = text.startsWith('[') ? JSON.parse(text) : [{ stream: 'stderr', time: '', text: text.trim() }];
        for (const line of batch) {
          pending.push({ ...line, id: next++ });
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
  }, [container, tail]);

  const shown = frozen ?? lines;
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(
    () => shown.filter((line) => (stream === 'all' || line.stream === stream) && (!needle || line.text.toLowerCase().includes(needle))),
    [shown, stream, needle],
  );

  useLayoutEffect(() => {
    if (following && frame.current) {
      frame.current.scrollTop = frame.current.scrollHeight;
    }
  }, [visible, following, wrap, timestamps]);

  const download = () => {
    const href = URL.createObjectURL(
      new Blob([visible.map((line) => (line.time ? `${line.time} ${line.text}` : line.text)).join('\n')], { type: 'text/plain' }),
    );
    const link = document.createElement('a');
    link.href = href;
    link.download = `${name}.log`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TagChip color={frozen ? 'blue' : ({ connecting: 'gray', live: 'green', reconnecting: 'yellow', stopped: 'gray' } as const)[status]} label={frozen ? 'paused' : status} />
        <div className="flex items-center gap-1">
          <span className="mono-sm text-faint">lines</span>
          <Segmented
            label="Lines of history"
            onChange={(value) => {
              setTail(value);
              save('console.logs.tail', value);
            }}
            options={tails}
            value={tail}
          />
        </div>
        <Segmented label="Streams" onChange={setStream} options={streams} value={stream} />
        <div className="flex flex-wrap gap-1">
          <Pill
            active={timestamps}
            onClick={() => {
              setTimestamps(!timestamps);
              save('console.logs.timestamps', !timestamps);
            }}
          >
            timestamps
          </Pill>
          <Pill
            active={wrap}
            onClick={() => {
              setWrap(!wrap);
              save('console.logs.wrap', !wrap);
            }}
          >
            wrap
          </Pill>
          <Pill active={Boolean(frozen)} onClick={() => setFrozen(frozen ? undefined : lines)}>
            {frozen ? 'resume' : 'pause'}
          </Pill>
          <Pill
            onClick={() => {
              setLines([]);
              setFrozen(undefined);
            }}
          >
            clear
          </Pill>
          <Pill onClick={download}>download</Pill>
        </div>
        <input aria-label="Filter log lines" className="max-w-56" onChange={(event) => setFilter(event.target.value)} placeholder="Filter lines" type="search" value={filter} />
      </div>
      <div
        className={`log-frame ${wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'}`}
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 40);
        }}
        ref={frame}
      >
        {visible.length ? (
          visible.map((line) => <Row key={line.id} line={line} timestamps={timestamps} />)
        ) : (
          <span className="text-faint">
            {shown.length ? 'No lines match.' : status === 'stopped' ? 'No log lines yet. The stream resumes when the container starts.' : 'Waiting for log lines…'}
          </span>
        )}
      </div>
      {!following && <Pill onClick={() => setFollowing(true)}>jump to the latest line</Pill>}
    </div>
  );
}
