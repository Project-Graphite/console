import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { socketUrl } from '../api';

export function Terminal({ path }: { path: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: { background: '#000000', foreground: '#e8e8ea' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current!);
    fit.fit();

    const socket = new WebSocket(socketUrl(path));
    socket.binaryType = 'arraybuffer';
    const resize = () => {
      fit.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(`\u0000resize:${terminal.cols}x${terminal.rows}`);
      }
    };
    socket.onopen = resize;
    socket.onmessage = (event) =>
      terminal.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer));
    socket.onclose = () => terminal.write('\r\n\x1b[90m[session closed]\x1b[0m\r\n');
    const input = terminal.onData((data) => socket.readyState === WebSocket.OPEN && socket.send(data));
    window.addEventListener('resize', resize);
    terminal.focus();

    return () => {
      window.removeEventListener('resize', resize);
      input.dispose();
      socket.close();
      terminal.dispose();
    };
  }, [path]);

  return <div className="terminal-frame h-[32rem]" ref={host} />;
}
