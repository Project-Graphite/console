import { Button } from '@project-graphite/ui';
import { useEffect, useState } from 'react';
import { get, post } from '../api';

interface Status {
  state: 'none' | 'running' | 'done' | 'failed';
  log: string;
}

export function Redeploy({ project, onDone }: { project: string; onDone: () => void }) {
  const [watching, setWatching] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    if (!watching) {
      return;
    }
    const timer = setInterval(() => {
      get<Status>(`/api/projects/${project}/redeploy`).then(
        (next) => {
          setStatus(next);
          setMessage(undefined);
          if (next.state === 'done' || next.state === 'failed') {
            setWatching(false);
            onDone();
          }
        },
        () => setMessage('Waiting for the console to answer…'),
      );
    }, 3000);
    return () => clearInterval(timer);
  }, [watching, project, onDone]);

  const start = () => {
    setStatus(undefined);
    setMessage('Starting…');
    post(`/api/projects/${project}/redeploy`).then(
      () => {
        setMessage(undefined);
        setStatus({ state: 'running', log: '' });
        setWatching(true);
      },
      (error: Error) => setMessage(error.message),
    );
  };

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <Button disabled={watching} onClick={start} size="small">
          Redeploy
        </Button>
        <span className="mono-sm text-muted">
          {message ?? (status?.state === 'running' ? 'Redeploying…' : status?.state === 'done' ? 'Redeployed.' : status?.state === 'failed' ? 'The redeploy failed:' : '')}
        </span>
      </span>
      {status?.state === 'failed' && status.log && <pre className="mono-sm max-h-48 overflow-auto whitespace-pre-wrap text-faint">{status.log}</pre>}
    </span>
  );
}
