export function Sparkline({ values, max, label }: { values: number[]; max?: number; label: string }) {
  if (values.length < 2) {
    return <p className="mono-sm text-faint">collecting history…</p>;
  }
  const top = max ?? Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${30 - (Math.min(value, top) / top) * 28}`).join(' ');
  return (
    <svg aria-label={label} className="h-10 w-full text-muted" preserveAspectRatio="none" role="img" viewBox="0 0 100 30">
      <polyline fill="none" points={points} stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
