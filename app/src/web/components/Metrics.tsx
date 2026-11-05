import { useState } from 'react';
import { bytes, percent, ranges, type HistoryData, type Range } from '../api';
import { load, save } from '../stored';
import { usePoll } from '../usePoll';
import { Chart } from './Chart';
import { Segmented } from './Segmented';

export function Metrics({ query, cpuMax, memoryMax }: { query: string; cpuMax?: number; memoryMax?: number }) {
  const [range, setRange] = useState<Range>(() => {
    const saved = load<string>('console.range', '1d');
    return ranges.includes(saved as Range) ? (saved as Range) : '1d';
  });
  const { data } = usePoll<HistoryData>(`/api/history?${query}&range=${range}`, 60_000);
  const chart = data && { series: data.series, breakdown: data.breakdown, span: data.span, step: data.step, now: Date.now() };
  return (
    <section className="stat-card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="mono-sm text-muted">Usage</h2>
        <Segmented
          label="Time range"
          onChange={(option) => {
            setRange(option);
            save('console.range', option);
          }}
          options={ranges}
          value={range}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {chart ? (
          <>
            <Chart {...chart} format={percent} label="CPU" max={cpuMax} metric="cpu" />
            <Chart {...chart} format={bytes} label="Memory" max={memoryMax} metric="memory" />
          </>
        ) : (
          <p className="mono-sm h-[200px] text-faint">loading…</p>
        )}
      </div>
    </section>
  );
}
