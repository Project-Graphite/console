import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { authenticate, callback, login, logout, type User } from './auth.ts';
import { config } from './config.ts';
import { docker } from './docker.ts';
import { docs } from './docs.ts';
import { History, ranges, type Range } from './history.ts';
import { collect, containers, diskUsage, projects, refresh, snapshot, type ContainerView } from './inventory.ts';
import { open, openSocket, parseOpen } from './proxy.ts';
import { projectsOf } from './registry.ts';
import { logs, terminal } from './terminal.ts';

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const history = new History(config.dataDir);
collect(history);

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const policy = [
  "default-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

function requireOwner(user: User) {
  if (!user.owner) {
    throw new Refusal(403, 'Only organisation owners can do that.');
  }
}

async function scope(user: User) {
  return user.owner ? undefined : await projectsOf(user.login);
}

function allowed(visible: Set<string> | undefined, container: ContainerView) {
  return !visible || visible.has(container.project);
}

async function findContainer(user: User, id: string) {
  const visible = await scope(user);
  const container = (await containers()).find((candidate) => candidate.id.startsWith(id));
  if (!container || !allowed(visible, container)) {
    throw new Refusal(404, 'No such container.');
  }
  return container;
}

async function visibleProjects(user: User) {
  const visible = await scope(user);
  const views = (await containers())
    .filter((container) => allowed(visible, container))
    .map((container) => (user.owner ? container : { ...container, networks: {} }));
  return projects(views, await diskUsage());
}

async function findProject(user: User, slug: string) {
  const project = (await visibleProjects(user)).find((candidate) => candidate.slug === slug);
  if (!project) {
    throw new Refusal(404, 'No such project.');
  }
  return project;
}

function rangeOf(url: URL) {
  const range = url.searchParams.get('range') ?? '1d';
  if (!(range in ranges)) {
    throw new Refusal(400, `Unknown range ${range}.`);
  }
  return range as Range;
}

async function api(user: User, method: string, url: URL) {
  const route = `${method} ${url.pathname}`;
  if (route === 'GET /api/me') {
    return { ...user, ssh: user.owner ? config.sshTarget : null };
  }
  if (route === 'GET /api/docs') {
    return docs();
  }
  if (route === 'GET /api/overview') {
    const [{ host }, usage, list] = await Promise.all([snapshot(), diskUsage(), visibleProjects(user)]);
    return {
      host: user.owner ? host : null,
      docker: user.owner
        ? {
            images: usage.images,
            containers: usage.containers,
            buildCache: usage.buildCache,
            volumes: usage.volumes.reduce((sum, volume) => sum + Math.max(0, volume.size), 0),
          }
        : null,
      projects: list,
    };
  }
  const project = /^GET \/api\/projects\/([a-z0-9-]+)$/.exec(route);
  if (project) {
    const [found, usage] = await Promise.all([findProject(user, project[1]), diskUsage()]);
    const images = new Map<string, { id: string; name: string; size: number | null; usedBy: string[] }>();
    for (const container of found.containers) {
      const image = images.get(container.imageId) ?? { id: container.imageId, name: container.image, size: usage.imageSizes[container.imageId] ?? null, usedBy: [] };
      image.usedBy.push(container.service);
      images.set(container.imageId, image);
    }
    return { ...found, images: [...images.values()], volumes: usage.volumes.filter((volume) => volume.project === found.slug) };
  }
  if (route === 'GET /api/history') {
    const range = rangeOf(url);
    const slug = url.searchParams.get('project');
    if (slug) {
      const found = await findProject(user, slug);
      return { ...ranges[range], series: found.containers.map((container) => ({ name: container.service, points: history.series(container.name, range) })) };
    }
    const target = url.searchParams.get('target') ?? '';
    if (target === 'host') {
      requireOwner(user);
    } else {
      const visible = await scope(user);
      const container = (await containers()).find((candidate) => candidate.name === target);
      if (!container || !allowed(visible, container)) {
        throw new Refusal(404, 'No such container.');
      }
    }
    return { ...ranges[range], series: [{ name: target, points: history.series(target, range) }] };
  }

  requireOwner(user);
  if (route === 'GET /api/images') {
    const [images, all] = await Promise.all([
      docker<{ Id: string; RepoTags: string[] | null; Size: number; Created: number }[]>('GET', '/images/json'),
      docker<{ ImageID: string; Names: string[] }[]>('GET', '/containers/json?all=1'),
    ]);
    return images.map((image) => ({
      id: image.Id,
      tags: image.RepoTags ?? [],
      size: image.Size,
      created: image.Created * 1000,
      usedBy: all.filter((container) => container.ImageID === image.Id).map((container) => container.Names[0].replace(/^\//, '')),
    }));
  }
  if (route === 'GET /api/disk') {
    return diskUsage();
  }
  if (route === 'POST /api/prune') {
    const result = await docker<{ SpaceReclaimed: number }>('POST', `/images/prune?filters=${encodeURIComponent('{"dangling":["true"]}')}`);
    return { reclaimed: result.SpaceReclaimed };
  }
  const action = /^POST \/api\/containers\/([0-9a-f]{12,64})\/(start|stop|restart)$/.exec(route);
  if (action) {
    const container = await findContainer(user, action[1]);
    await docker('POST', `/containers/${container.id}/${action[2]}`);
    await refresh();
    return { ok: true };
  }
  const wake = /^POST \/api\/projects\/([a-z0-9-]+)\/wake$/.exec(route);
  if (wake) {
    const response = await fetch(`${config.sablierUrl}/api/strategies/blocking?group=${wake[1]}&session_duration=30m&timeout=2m`, {
      signal: AbortSignal.timeout(130_000),
    });
    if (!response.ok) {
      throw new Refusal(502, `Sablier answered ${response.status}.`);
    }
    await refresh();
    return { ok: true };
  }
  throw new Refusal(404, 'Not found.');
}

async function serveFile(response: http.ServerResponse, pathname: string) {
  const name = pathname === '/' || !/\.[a-z0-9]+$/.test(pathname) ? 'index.html' : pathname.slice(1);
  try {
    const body = await readFile(new URL(name, config.webRoot));
    const extension = name.slice(name.lastIndexOf('.'));
    response.writeHead(200, {
      'Content-Type': types[extension] ?? 'application/octet-stream',
      'Cache-Control': name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found.');
  }
}

async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url ?? '/', config.appUrl);
  if (url.pathname === '/healthz') {
    response.writeHead(200).end('ok');
    return;
  }
  if (url.pathname.startsWith('/auth/') && config.github) {
    if (url.pathname === '/auth/login') return login(response);
    if (url.pathname === '/auth/callback') return callback(request, response, url);
    if (url.pathname === '/auth/logout') return logout(response);
  }

  const user = await authenticate(request);
  if (!user) {
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(401).end();
    } else {
      response.writeHead(302, { Location: '/auth/login' }).end();
    }
    return;
  }

  const target = parseOpen(url.pathname);
  if (target) {
    requireOwner(user);
    await findContainer(user, target.container);
    return open(request, response, target, url.search);
  }
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'POST' && request.headers.origin && request.headers.origin !== new URL(config.appUrl).origin) {
      throw new Refusal(403, 'Cross-origin requests are refused.');
    }
    const body = await api(user, request.method ?? 'GET', url);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
    return;
  }
  await serveFile(response, url.pathname);
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    const status = error instanceof Refusal ? error.status : 500;
    if (status === 500) {
      console.error(error);
    }
    if (!response.headersSent) {
      response.writeHead(status, { 'Content-Type': 'text/plain' });
    }
    response.end(error instanceof Error ? error.message : 'Something went wrong.');
  });
});

const sockets = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  void (async () => {
    const url = new URL(request.url ?? '/', config.appUrl);
    const user = await authenticate(request);
    if (!user || (config.production && request.headers.origin !== new URL(config.appUrl).origin)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const target = parseOpen(url.pathname);
    if (target) {
      requireOwner(user);
      await findContainer(user, target.container);
      return openSocket(request, socket, head, target, url.search);
    }
    const container = url.searchParams.get('container') ?? '';
    if (url.pathname === '/ws/terminal' || url.pathname === '/ws/host') {
      requireOwner(user);
    }
    const found = url.pathname === '/ws/host' ? undefined : await findContainer(user, container);
    sockets.handleUpgrade(request, socket, head, (client) => {
      const run =
        url.pathname === '/ws/logs'
          ? logs(client, found!.id)
          : url.pathname === '/ws/terminal'
            ? terminal(client, { container: found!.id })
            : url.pathname === '/ws/host'
              ? terminal(client, 'host')
              : Promise.reject(new Error('Unknown socket.'));
      run.catch((error: unknown) => {
        client.send(`\r\n${error instanceof Error ? error.message : 'The session failed.'}\r\n`);
        client.close();
      });
    });
  })().catch((error: unknown) => {
    const status = error instanceof Refusal ? error.status : 500;
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n\r\n`);
  });
});

server.listen(config.port, () => console.log(`The console is listening on ${config.port}.`));
