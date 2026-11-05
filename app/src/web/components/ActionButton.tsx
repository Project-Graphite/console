import Tooltip from '@mui/material/Tooltip';
import { Button, type ButtonVariant } from '@project-graphite/ui';
import { useEffect, useState } from 'react';

export interface ActionLabels {
  idle: string;
  busy: string;
  done: string;
  failed: string;
}

export function ActionButton({
  labels,
  run,
  disabled = false,
  variant = 'secondary',
}: {
  labels: ActionLabels;
  run: () => Promise<unknown>;
  disabled?: boolean;
  variant?: ButtonVariant;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (state !== 'done') {
      return;
    }
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  const start = () => {
    setState('busy');
    run().then(
      () => setState('done'),
      (reason: Error) => {
        setError(reason.message);
        setState('failed');
      },
    );
  };

  return (
    <Tooltip title={state === 'failed' ? <span className="whitespace-pre-wrap">{error}</span> : ''}>
      <span>
        <Button
          aria-busy={state === 'busy'}
          className="min-w-28"
          disabled={state === 'busy' || state === 'done' || (state === 'idle' && disabled)}
          icon={state === 'done' ? 'check' : undefined}
          onClick={start}
          size="small"
          variant={state === 'failed' ? 'danger' : variant}
        >
          <span aria-live="polite">{labels[state]}</span>
        </Button>
      </span>
    </Tooltip>
  );
}
