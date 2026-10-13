export interface User {
  login: string;
  owner: boolean;
  ssh: string | null;
}

export interface Container {
  id: string;
  name: string;
  project: string;
  service: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
  created: number;
  ports: number[];
  networks: Record<string, string>;
  sleeps: boolean;
  cpu: number | null;
  memory: number | null;
  memoryLimit: number | null;
}

export interface Project {
  slug: string;
  sleeps: boolean;
  asleep: boolean;
  containers: Container[];
}

export interface Usage {
  used: number;
  total: number;
}

export interface Host {
  cpu: number;
  cpus: number;
  load: number[];
  uptime: number;
  disk: Usage;
  memory: Usage;
  swap: Usage;
}

export interface Overview {
  host: Host | null;
  projects: Project[];
}

export interface Point {
  at: number;
  cpu: number;
  memory: number;
}

export interface Image {
  id: string;
  tags: string[];
  size: number;
  created: number;
  usedBy: string[];
}

export interface Disk {
  images: number;
  containers: number;
  buildCache: number;
  volumes: { name: string; project: string | null; size: number; inUse: boolean }[];
}

export class Unauthorized extends Error {}

async function request<T>(method: string, path: string) {
  const response = await fetch(path, { method, headers: { Accept: 'application/json' } });
  if (response.status === 401) {
    throw new Unauthorized();
  }
  if (!response.ok) {
    throw new Error((await response.text()) || `The console answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string) => request<T>('POST', path);

export function bytes(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function socketUrl(path: string) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}
