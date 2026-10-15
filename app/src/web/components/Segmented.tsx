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
        <button
          aria-pressed={option === value}
          className={`mono-sm rounded-md border px-2 py-0.5 ${option === value ? 'border-line bg-paper text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          key={option}
          onClick={() => onChange(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}
