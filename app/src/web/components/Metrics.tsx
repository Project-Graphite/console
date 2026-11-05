import { useState } from 'react';
import { bytes, percent, rate, ranges, type HistoryData, type Metric, type Series } from '../api';
import { containerPoint, hostPoint, liveSeconds, useLive } from '../live';
import { load, save } from '../stored';
import { usePoll } from '../usePoll';
import { Chart } from './Chart';
import { Segmented } from './Segmented';

const options = ['live', ...ranges] as const;
type Option = (typeof options)[number];

export type LiveTargets = 'host' | { name: string; label: string }[];

export function Metrics({ query, live, cpuMax, memoryMax }: { query: string; live: LiveTargets; cpuMax?: number; memoryMax?: number }) {
  const [range, setRange] = useState<Option>(() => {
    const saved = load<string>('console.range', '1d');
    return options.includes(saved as Option) ? (saved as Option) : '1d';
  });
  const [peaks, setPeaks] = useState(false);
  const frames = useLive();
  const { data } = usePoll<HistoryData>(`/api/history?${query}&range=${range === 'live' ? '1h' : range}`, 60_000);

  const liveSeries: Series[] =
    live === 'host'
      ? [{ name: 'VPS', points: frames.map(hostPoint) }]
      : live.map(({ name, label }) => ({ name: label, points: frames.flatMap((frame) => containerPoint(frame, name) ?? []) }));
  const chart =
    range === 'live'
      ? { series: liveSeries, span: liveSeconds * 1000, step: 1000, now: frames.at(-1)?.at ?? Date.now() }
      : data && { series: data.series, breakdown: data.breakdown, span: data.span, step: data.step, now: Date.now() };
  const peak = (metric: Metric): Metric => (peaks && range !== 'live' ? (metric === 'cpu' ? 'cpuPeak' : 'memoryPeak') : metric);

  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="mono-sm text-muted">Usage</h2>
        <span className="flex flex-wrap items-center gap-2">
          {range !== 'live' && <Segmented label="Show" onChange={(option) => setPeaks(option === 'peak')} options={['average', 'peak'] as const} value={peaks ? 'peak' : 'average'} />}
          <Segmented
            label="Time range"
            onChange={(option) => {
              setRange(option);
              save('console.range', option);
            }}
            options={options}
            value={range}
          />
        </span>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {chart ? (
          <>
            <Chart {...chart} format={percent} label={peaks && range !== 'live' ? 'CPU, peak per minute' : 'CPU'} max={cpuMax} metric={peak('cpu')} />
            <Chart {...chart} format={bytes} label={peaks && range !== 'live' ? 'Memory, peak per minute' : 'Memory'} max={memoryMax} metric={peak('memory')} />
            <Chart {...chart} breakdown={undefined} format={rate} label="Network, in and out" metric="net" />
            <Chart {...chart} breakdown={undefined} format={rate} label="Disk, read and written" metric="io" />
          </>
        ) : (
          <p className="mono-sm h-[200px] text-faint">loading…</p>
        )}
      </div>
    </section>
  );
}
