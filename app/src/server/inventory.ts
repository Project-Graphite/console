import { cpuPercent, docker, memoryUsed, type DockerContainer, type DockerStats } from './docker.ts';
import type { History } from './history.ts';
import { hostStats } from './host.ts';

export interface ContainerView {
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

const statsTtl = 5000;
let snapshot: { at: number; views: ContainerView[] } | undefined;

function health(status: string) {
  return /\((healthy|unhealthy|health: starting)\)/.exec(status)?.[1] ?? null;
}

function view(container: DockerContainer, stats?: DockerStats): ContainerView {
  return {
    id: container.Id,
    name: container.Names[0].replace(/^\//, ''),
    project: container.Labels['com.docker.compose.project'] ?? 'other',
    service: container.Labels['com.docker.compose.service'] ?? container.Names[0].replace(/^\//, ''),
    image: container.Image,
    state: container.State,
    status: container.Status,
    health: health(container.Status),
    created: container.Created * 1000,
    ports: [...new Set(container.Ports.map((port) => port.PrivatePort))].sort((a, b) => a - b),
    networks: Object.fromEntries(Object.entries(container.NetworkSettings.Networks).map(([name, network]) => [name, network.IPAddress])),
    sleeps: container.Labels['sablier.enable'] === 'true',
    cpu: stats ? cpuPercent(stats) : null,
    memory: stats ? memoryUsed(stats) : null,
    memoryLimit: stats?.memory_stats.limit ?? null,
  };
}

async function measure() {
  const containers = await docker<DockerContainer[]>('GET', '/containers/json?all=1');
  const stats = await Promise.all(
    containers.map((container) =>
      container.State === 'running'
        ? docker<DockerStats>('GET', `/containers/${container.Id}/stats?stream=false`).catch(() => undefined)
        : undefined,
    ),
  );
  return containers.map((container, index) => view(container, stats[index]));
}

export async function containers() {
  if (!snapshot || Date.now() - snapshot.at > statsTtl) {
    snapshot = { at: Date.now(), views: await measure() };
  }
  return snapshot.views;
}

export function projects(views: ContainerView[]) {
  const grouped = new Map<string, ContainerView[]>();
  for (const container of views) {
    grouped.set(container.project, [...(grouped.get(container.project) ?? []), container]);
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, members]) => ({
      slug,
      sleeps: members.some((member) => member.sleeps),
      asleep: members.some((member) => member.sleeps) && members.every((member) => member.state !== 'running'),
      containers: members.sort((a, b) => a.service.localeCompare(b.service)),
    }));
}

export function sample(history: History, every = 60_000) {
  const tick = async () => {
    const [host, views] = await Promise.all([hostStats(), measure()]);
    history.record(Date.now(), [
      { target: 'host', cpu: host.cpu, memory: host.memory.used },
      ...views.filter((container) => container.cpu !== null).map((container) => ({
        target: container.name,
        cpu: container.cpu!,
        memory: container.memory!,
      })),
    ]);
  };
  const timer = setInterval(() => void tick().catch((error) => console.error('sample failed:', error)), every);
  void hostStats();
  return () => clearInterval(timer);
}
