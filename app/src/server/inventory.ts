import { cpuPercent, docker, memoryUsed, type DockerContainer, type DockerStats } from './docker.ts';
import type { History } from './history.ts';
import { hostStats } from './host.ts';

export interface ContainerView {
  id: string;
  name: string;
  project: string;
  service: string;
  image: string;
  imageId: string;
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

export interface Disk {
  images: number;
  containers: number;
  buildCache: number;
  imageSizes: Record<string, number>;
  volumes: { name: string; project: string | null; size: number; inUse: boolean }[];
}

type Snapshot = { host: Awaited<ReturnType<typeof hostStats>>; views: ContainerView[] };

let latest: Snapshot | undefined;
let measuring: Promise<Snapshot> | undefined;
let disk: Disk | undefined;
let reading: Promise<Disk> | undefined;

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
    imageId: container.ImageID,
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

export function refresh() {
  measuring ??= Promise.all([hostStats(), measure()])
    .then(([host, views]) => (latest = { host, views }))
    .finally(() => (measuring = undefined));
  return measuring;
}

export async function snapshot() {
  return latest ?? (await refresh());
}

export async function containers() {
  return (await snapshot()).views;
}

async function readDisk(): Promise<Disk> {
  const df = await docker<{
    LayersSize: number;
    Images: { Id: string; Size: number }[];
    Containers: { SizeRw?: number }[];
    Volumes: { Name: string; Labels: Record<string, string> | null; UsageData: { Size: number; RefCount: number } }[];
    BuildCache: { Size: number }[] | null;
  }>('GET', '/system/df');
  return {
    images: df.LayersSize,
    containers: df.Containers.reduce((sum, container) => sum + (container.SizeRw ?? 0), 0),
    buildCache: (df.BuildCache ?? []).reduce((sum, entry) => sum + entry.Size, 0),
    imageSizes: Object.fromEntries(df.Images.map((image) => [image.Id, image.Size])),
    volumes: df.Volumes.map((volume) => ({
      name: volume.Name,
      project: volume.Labels?.['com.docker.compose.project'] ?? null,
      size: volume.UsageData.Size,
      inUse: volume.UsageData.RefCount > 0,
    })),
  };
}

export function refreshDisk() {
  reading ??= readDisk()
    .then((value) => (disk = value))
    .finally(() => (reading = undefined));
  return reading;
}

export async function diskUsage() {
  return disk ?? (await refreshDisk());
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function projects(views: ContainerView[], usage?: Disk) {
  const grouped = new Map<string, ContainerView[]>();
  for (const container of views) {
    grouped.set(container.project, [...(grouped.get(container.project) ?? []), container]);
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, members]) => {
      const measured = members.filter((member) => member.cpu !== null);
      return {
        slug,
        sleeps: members.some((member) => member.sleeps),
        asleep: members.some((member) => member.sleeps) && members.every((member) => member.state !== 'running'),
        cpu: measured.length ? sum(measured.map((member) => member.cpu!)) : null,
        memory: measured.length ? sum(measured.map((member) => member.memory!)) : null,
        storage: usage
          ? {
              volumes: sum(usage.volumes.filter((volume) => volume.project === slug).map((volume) => Math.max(0, volume.size))),
              images: sum([...new Set(members.map((member) => member.imageId))].map((id) => usage.imageSizes[id] ?? 0)),
            }
          : null,
        containers: members.sort((a, b) => a.service.localeCompare(b.service)),
      };
    });
}

export function collect(history: History, { measureEvery = 5000, recordEvery = 60_000, diskEvery = 300_000 } = {}) {
  const record = async () => {
    const { host, views } = await snapshot();
    history.record(Date.now(), [
      { target: 'host', cpu: host.cpu, memory: host.memory.used },
      ...views.filter((container) => container.cpu !== null).map((container) => ({
        target: container.name,
        cpu: container.cpu!,
        memory: container.memory!,
      })),
    ]);
  };
  const report = (task: string) => (error: unknown) => console.error(`${task} failed:`, error);
  const timers = [
    setInterval(() => void refresh().catch(report('measure')), measureEvery),
    setInterval(() => void record().catch(report('sample')), recordEvery),
    setInterval(() => void refreshDisk().catch(report('disk usage')), diskEvery),
  ];
  void refresh().catch(report('measure'));
  void refreshDisk().catch(report('disk usage'));
  return () => timers.forEach(clearInterval);
}
