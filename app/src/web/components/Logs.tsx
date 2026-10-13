import { useEffect, useRef, useState } from 'react';
import { socketUrl } from '../api';

const keep = 2000;

export function Logs({ container }: { container: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const frame = useRef<HTMLPreElement>(null);

  useEffect(() => {
    setLines([]);
    const socket = new WebSocket(socketUrl(`/ws/logs?container=${container}`));
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
      {lines.length ? lines.join('\n') : 'Waiting for log lines…'}
    </pre>
  );
}
