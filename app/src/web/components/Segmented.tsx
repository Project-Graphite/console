import type { ReactNode } from 'react';

export function Pill({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      aria-pressed={active}
      className={`mono-sm rounded-md border px-2 py-0.5 ${active ? 'border-line bg-paper text-ink' : 'border-transparent text-muted hover:text-ink'}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <div aria-label={label} className="flex gap-1" role="group">
      {options.map((option) => (
        <Pill active={option === value} key={option} onClick={() => onChange(option)}>
          {option}
        </Pill>
      ))}
    </div>
  );
}
