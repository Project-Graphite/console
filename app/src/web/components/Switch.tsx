import MuiSwitch from '@mui/material/Switch';
import { useId } from 'react';

export function Switch({
  checked,
  onChange,
  label,
  hideLabel = false,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hideLabel?: boolean;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const control = (
    <MuiSwitch
      checked={checked}
      disabled={disabled}
      id={id}
      onChange={(event) => onChange(event.target.checked)}
      size="small"
      slotProps={{ input: { 'aria-label': hideLabel ? label : undefined } }}
    />
  );
  if (hideLabel) {
    return control;
  }
  return (
    <label className={`flex items-start gap-2 ${disabled ? 'opacity-60' : 'cursor-pointer'}`} htmlFor={id}>
      {control}
      <span className="pt-1">
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mono-sm block text-faint">{description}</span>}
      </span>
    </label>
  );
}
