import { useSyncExternalStore } from 'react';
import type { Frame, Point } from './api';

export const liveSeconds = 180;

let frames: Frame[] = [];
let source: EventSource | undefined;
const listeners = new Set<() => void>();

function publish(next: Frame[]) {
  frames = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!source) {
    source = new EventSource('/api/live');
    source.addEventListener('backlog', (event) => publish(JSON.parse((event as MessageEvent<string>).data) as Frame[]));
    source.addEventListener('frame', (event) => publish([...frames.slice(1 - liveSeconds), JSON.parse((event as MessageEvent<string>).data) as Frame]));
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      source?.close();
      source = undefined;
      frames = [];
    }
  };
}

export function useLive() {
  return useSyncExternalStore(subscribe, () => frames);
}

export function hostPoint(frame: Frame): Point {
  const { host } = frame;
  return { at: frame.at, cpu: host.cpu, cpuPeak: host.cpu, memory: host.memory.used, memoryPeak: host.memory.used, net: host.rx + host.tx, io: host.read + host.write };
}

export function containerPoint(frame: Frame, name: string): Point | undefined {
  const container = frame.containers[name];
  return (
    container && {
      at: frame.at,
      cpu: container.cpu,
      cpuPeak: container.cpu,
      memory: container.memory,
      memoryPeak: container.memory,
      net: container.rx + container.tx,
      io: container.read + container.write,
    }
  );
}

export function projectSeries(frames: Frame[]) {
  const series = new Map<string, Point[]>();
  for (const frame of frames) {
    const totals = new Map<string, Point>();
    for (const container of Object.values(frame.containers)) {
      const total = totals.get(container.project) ?? { at: frame.at, cpu: 0, cpuPeak: 0, memory: 0, memoryPeak: 0, net: 0, io: 0 };
      total.cpu += container.cpu / frame.host.cpus;
      total.cpuPeak = total.cpu;
      total.memory += container.memory;
      total.memoryPeak = total.memory;
      total.net += container.rx + container.tx;
      total.io += container.read + container.write;
      totals.set(container.project, total);
    }
    for (const [project, point] of totals) {
      series.set(project, [...(series.get(project) ?? []), point]);
    }
  }
  return [...series].map(([name, points]) => ({ name, points }));
}

export function projectTotals(frame: Frame | undefined) {
  const totals = new Map<string, { cpu: number; memory: number }>();
  for (const container of Object.values(frame?.containers ?? {})) {
    const total = totals.get(container.project) ?? { cpu: 0, memory: 0 };
    total.cpu += container.cpu;
    total.memory += container.memory;
    totals.set(container.project, total);
  }
  return totals;
}
