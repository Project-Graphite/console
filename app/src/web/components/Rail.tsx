import { TagChip, type TagColor } from '@project-graphite/ui';
import type { ReactNode } from 'react';

export interface Stat {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  pill?: TagColor;
}

export function Rail({ title, stats, children }: { title: string; stats: Stat[]; children?: ReactNode }) {
  return (
    <aside className="stat-card space-y-4 lg:sticky lg:top-20">
      <h2 className="mono-sm text-muted">{title}</h2>
      <dl className="space-y-3">
        {stats.map((stat) => (
          <div className="space-y-1" key={stat.label}>
            <dt className="mono-sm text-faint">{stat.label}</dt>
            <dd className="text-lg text-ink">{stat.pill ? <TagChip color={stat.pill} label={String(stat.value)} /> : stat.value}</dd>
            {stat.detail && <dd className="mono-sm text-faint">{stat.detail}</dd>}
          </div>
        ))}
      </dl>
      {children}
    </aside>
  );
}

export function WithRail({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-6">{children}</div>
      {rail}
    </div>
  );
}
