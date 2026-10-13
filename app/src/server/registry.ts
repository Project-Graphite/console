import { config } from './config.ts';

interface Registry {
  members: { handle: string; github: string }[];
  projects: { slug: string; owner: string; authors: string[] }[];
}

const ttl = 5 * 60 * 1000;
let cached: { at: number; registry: Registry } | undefined;

export function ownedBy(registry: Registry, login: string) {
  const name = login.toLowerCase();
  const handles = new Set(registry.members.filter((member) => member.github.toLowerCase() === name).map((member) => member.handle));
  return new Set(
    registry.projects
      .filter((project) => handles.has(project.owner) || project.authors.some((author) => author.toLowerCase() === name))
      .map((project) => project.slug),
  );
}

async function registry() {
  if (cached && Date.now() - cached.at < ttl) {
    return cached.registry;
  }
  try {
    const response = await fetch(config.registryUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`the registry answered ${response.status}`);
    }
    cached = { at: Date.now(), registry: (await response.json()) as Registry };
  } catch (error) {
    if (!cached) {
      throw error;
    }
  }
  return cached!.registry;
}

export async function projectsOf(login: string) {
  return ownedBy(await registry(), login);
}
