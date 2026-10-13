import { useEffect, useRef, useState } from 'react';
import { socketUrl } from '../api';

const keep = 2000;

export function Logs({ container }: { container: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [closed, setClosed] = useState(false);
  const frame = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setLines([]);
    setClosed(false);
    const socket = new WebSocket(socketUrl(`/ws/logs?container=${container}`));
    socket.onclose = () => setClosed(true);
    socket.onmessage = (event) =>
      setLines((current) => [...current, ...String(event.data).split('\n').filter(Boolean)].slice(-keep));
    return () => socket.close();
  }, [container]);

  useEffect(() => {
    const element = frame.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
      element.scrollTop = element.scrollHeight;
    }
  }, [lines]);

  return (
    <pre className="log-frame" ref={frame}>
      {lines.length ? lines.join('\n') : closed ? 'The log stream closed. Reload the page to try again.' : 'Waiting for log lines…'}
    </pre>
  );
}
