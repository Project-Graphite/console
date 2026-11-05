import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Series } from '../api';

const palette = ['#6a9eea', '#5fbf7f', '#e0915a', '#a388e8', '#4fb8b0', '#e07fb5', '#d7b24a', '#e5736b', '#8b8b95'];
const height = 180;
const pad = { top: 10, right: 10, bottom: 22, left: 58 };

export interface ChartProps {
  label: string;
  series: Series[];
  metric: 'cpu' | 'memory';
  span: number;
  step: number;
  now: number;
  format: (value: number) => string;
  max?: number;
  breakdown?: Series[];
}

function ceiling(value: number) {
  if (value <= 0) {
    return 1;
  }
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= value)!;
}

function timeLabel(at: number, span: number, precise = false) {
  const day = 24 * 3600_000;
  return new Intl.DateTimeFormat(undefined, {
    ...(span > day || precise ? { day: 'numeric', month: 'short' } : {}),
    ...(span <= 7 * day || precise ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(at);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function Breakdown({ lines, at, metric, total, format }: { lines: Series[]; at: number; metric: 'cpu' | 'memory'; total: number; format: (value: number) => string }) {
  const parts = lines
    .map((line) => ({ name: line.name, value: line.points.find((point) => point.at === at)?.[metric] ?? 0 }))
    .filter((part) => part.value > 0)
    .sort((a, b) => b.value - a.value);
  const rest = total - parts.reduce((sum, part) => sum + part.value, 0);
  const rows = rest > 0 ? [...parts, { name: 'system and other', value: rest }] : parts;
  return (
    <div className="mt-2 space-y-1 border-t border-line-soft pt-2">
      {rows.map((row) => (
        <div className="mono-sm" key={row.name}>
          <p className="flex gap-3 text-muted">
            <span className="flex-1">{row.name}</span>
            <span className="text-ink">{format(row.value)}</span>
          </p>
          <div className="h-0.5 rounded bg-line-soft">
            <div className="h-0.5 rounded bg-muted" style={{ width: `${Math.min(100, (100 * row.value) / Math.max(total, row.value))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Chart({ label, series, metric, span, step, now, format, max, breakdown }: ChartProps) {
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<{ at: number; name: string | undefined; x: number }>();
  const start = now - span;
  const plotted = series.filter((line) => line.points.length > 0);
  const top = max ?? ceiling(Math.max(0, ...plotted.flatMap((line) => line.points.map((point) => point[metric]))) * 1.1);
  const x = (at: number) => pad.left + ((at - start) / span) * Math.max(1, width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - Math.min(value, top) / top) * (height - pad.top - pad.bottom);
  const colors = new Map(series.map((line, index) => [line.name, palette[index % palette.length]]));

  const segments = (line: Series) => {
    const runs: Series['points'][] = [];
    for (const point of line.points) {
      const run = runs.at(-1);
      if (run && point.at - run.at(-1)!.at <= 2 * step) {
        run.push(point);
      } else {
        runs.push([point]);
      }
    }
    return runs;
  };

  const values = hover
    ? plotted
        .map((line) => ({ name: line.name, point: line.points.find((point) => point.at === hover.at) }))
        .filter((entry): entry is { name: string; point: Series['points'][number] } => entry.point !== undefined)
        .sort((a, b) => b.point[metric] - a.point[metric])
    : [];

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const at = Math.round((start + ((pointerX - pad.left) / Math.max(1, width - pad.left - pad.right)) * span) / step) * step;
    const nearest = plotted
      .map((line) => ({ name: line.name, point: line.points.find((point) => point.at === at) }))
      .filter((entry) => entry.point)
      .sort((a, b) => Math.abs(y(a.point![metric]) - pointerY) - Math.abs(y(b.point![metric]) - pointerY))[0];
    setHover(at >= start && at <= now ? { at, name: nearest?.name, x: x(at) } : undefined);
  };

  const ticks = (width < 480 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((fraction) => start + fraction * span);

  return (
    <div className="relative min-w-0" ref={ref}>
      <p className="mono-sm mb-1 text-muted">{label}</p>
      {plotted.length === 0 ? (
        <p className="mono-sm flex h-[180px] items-center justify-center text-faint">collecting history…</p>
      ) : (
        width > 0 && (
          <svg
            aria-label={label}
            className="block touch-none select-none"
            height={height}
            onPointerLeave={() => setHover(undefined)}
            onPointerMove={move}
            role="img"
            width={width}
          >
            {[0, 0.5, 1].map((fraction) => (
              <g key={fraction}>
                <line className="stroke-line-soft" x1={pad.left} x2={width - pad.right} y1={y(top * fraction)} y2={y(top * fraction)} />
                <text className="fill-faint text-[10px]" dominantBaseline="middle" textAnchor="end" x={pad.left - 6} y={y(top * fraction)}>
                  {format(top * fraction)}
                </text>
              </g>
            ))}
            {ticks.map((at, index) => (
              <text
                className="fill-faint text-[10px]"
                key={at}
                textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}
                x={x(at)}
                y={height - 6}
              >
                {timeLabel(at, span)}
              </text>
            ))}
            {plotted.map((line) =>
              segments(line).map((run) => (
                <polyline
                  fill="none"
                  key={`${line.name}-${run[0].at}`}
                  opacity={hover?.name && hover.name !== line.name ? 0.25 : 1}
                  points={run.map((point) => `${x(point.at)},${y(point[metric])}`).join(' ')}
                  stroke={colors.get(line.name)}
                  strokeLinejoin="round"
                  strokeWidth={hover?.name === line.name ? 2.5 : 1.5}
                />
              )),
            )}
            {hover && (
              <>
                <line className="stroke-muted" strokeDasharray="3 3" x1={hover.x} x2={hover.x} y1={pad.top} y2={height - pad.bottom} />
                {values.map(({ name, point }) => (
                  <circle cx={hover.x} cy={y(point[metric])} fill={colors.get(name)} key={name} r={name === hover.name ? 4 : 2.5} />
                ))}
              </>
            )}
          </svg>
        )
      )}
      {hover && values.length > 0 && (
        <div
          className="pointer-events-none absolute top-6 z-10 min-w-56 rounded-lg border border-line bg-paper px-3 py-2 shadow-lg"
          style={hover.x > width / 2 ? { right: width - hover.x + 12 } : { left: hover.x + 12 }}
        >
          <p className="mono-sm mb-1 text-muted">{timeLabel(hover.at, span, true)}</p>
          {values.map(({ name, point }) => (
            <p className={`mono-sm flex items-center gap-2 ${name === hover.name ? 'text-ink' : 'text-faint'}`} key={name}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors.get(name) }} />
              <span className="flex-1">{name}</span>
              <span className={name === hover.name ? 'font-semibold' : ''}>{format(point[metric])}</span>
            </p>
          ))}
          {breakdown && <Breakdown at={hover.at} format={format} lines={breakdown} metric={metric} total={values[0].point[metric]} />}
        </div>
      )}
      {series.length > 1 && (
        <p className="mono-sm mt-1 flex flex-wrap gap-x-3 gap-y-1 text-faint">
          {series.map((line) => (
            <span className="flex items-center gap-1" key={line.name}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colors.get(line.name) }} />
              {line.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
