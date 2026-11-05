import { createReadStream } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from './config.ts';
import { docker } from './docker.ts';
import { Refusal } from './refusal.ts';

export const volumePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function check(name: string) {
  if (!volumePattern.test(name)) {
    throw new Refusal(400, `${name} is not a volume name.`);
  }
}

export async function inside(name: string, relative: string, volumes = path.join(config.hostRoot, 'var/lib/docker/volumes')) {
  check(name);
  const root = path.join(volumes, name, '_data');
  if (!(await lstat(root).catch(() => undefined))?.isDirectory()) {
    throw new Refusal(404, `There is no volume ${name}.`);
  }
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Refusal(403, 'That path leads out of the volume.');
  }
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current).catch(() => {
      throw new Refusal(404, `There is no ${relative} in ${name}.`);
    });
    if (info.isSymbolicLink()) {
      throw new Refusal(403, 'That path leads out of the volume.');
    }
  }
  return target;
}

export async function listFiles(name: string, relative: string, volumes?: string) {
  const folder = await inside(name, relative, volumes);
  const entries = await readdir(folder, { withFileTypes: true });
  const rows = await Promise.all(
    entries.slice(0, 5000).map(async (entry) => {
      const info = await lstat(path.join(folder, entry.name));
      const kind = entry.isDirectory() ? 'folder' : entry.isSymbolicLink() ? 'link' : entry.isFile() ? 'file' : 'other';
      return { name: entry.name, kind, size: info.size, modified: info.mtimeMs };
    }),
  );
  return rows.sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || a.name.localeCompare(b.name));
}

export async function downloadFile(response: ServerResponse, name: string, relative: string) {
  const file = await inside(name, relative);
  const info = await stat(file);
  if (!info.isFile()) {
    throw new Refusal(400, 'Only a file can be downloaded.');
  }
  response.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': info.size,
    'Content-Disposition': `attachment; filename="${path.basename(file).replace(/["\\\r\n]/g, '_')}"`,
    'Cache-Control': 'no-store',
  });
  await pipeline(createReadStream(file), response);
}

export async function createVolume(name: unknown) {
  if (typeof name !== 'string') {
    throw new Refusal(400, 'Name the volume.');
  }
  check(name);
  await docker('POST', '/volumes/create', { Name: name, Labels: { 'graphite.created-by': 'console' } });
}

export async function removeVolume(name: string) {
  check(name);
  await docker('DELETE', `/volumes/${encodeURIComponent(name)}`).catch((error: Error) => {
    throw new Refusal(409, error.message.replace(/^Docker answered \d+ for [^:]+: /, ''));
  });
}
