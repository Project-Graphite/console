import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

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
    <ToggleButtonGroup aria-label={label} exclusive onChange={(_, next: T | null) => next !== null && onChange(next)} size="small" value={value}>
      {options.map((option) => (
        <ToggleButton className="mono-sm px-2 py-0.5 normal-case" key={option} value={option}>
          {option}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
