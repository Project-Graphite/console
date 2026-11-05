import ButtonBase from '@mui/material/ButtonBase';
import { Icon } from '@project-graphite/ui';
import type { ReactNode } from 'react';

export function Collapsible({ title, open, onToggle, adornment, children }: { title: ReactNode; open: boolean; onToggle: (open: boolean) => void; adornment?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface">
      <ButtonBase aria-expanded={open} className="flex w-full items-center justify-start gap-2 px-3.5 py-2.5 text-left hover:bg-line-soft" onClick={() => onToggle(!open)}>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>
          <Icon name="chevron-right" size={14} />
        </span>
        <span className="mono-sm truncate">{title}</span>
        {adornment}
      </ButtonBase>
      {open && <div className="border-t border-line">{children}</div>}
    </div>
  );
}
