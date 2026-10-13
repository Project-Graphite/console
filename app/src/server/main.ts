import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { Access, permits, scopePattern } from './access.ts';
import { authenticate, callback, githubToken, login, logout, organisationMembers, roleNow, sessionMs, type Role, type User } from './auth.ts';
import { config } from './config.ts';
import { docker } from './docker.ts';
import { docs } from './docs.ts';
import { History, ranges, type Range } from './history.ts';
import { collect, containers, diskUsage, projects, refresh, snapshot } from './inventory.ts';
import { open, openSocket, parseOpen } from './proxy.ts';
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
const access = new Access(config.dataDir);
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

const held = new Map<string, Set<{ scope: string; owner: boolean; close: () => void }>>();

function allows(role: Role | undefined, login: string, scope: string) {
  return role === 'owner' || (role === 'member' && permits(access.scopes(login), scope));
}

function closeRevoked(login: string, role?: Role) {
  for (const entry of held.get(login.toLowerCase()) ?? []) {
    if (!allows(role ?? (entry.owner ? 'owner' : 'member'), login, entry.scope)) {
      entry.close();
    }
  }
}

async function requireNow(request: http.IncomingMessage, user: User, scope: string) {
  const role = await roleNow(githubToken(request));
  if (!allows(role, user.login, scope)) {
    closeRevoked(user.login, role);
    throw new Refusal(403, role ? `You do not have write access to ${scope.replace(/^\w+:/, '')}.` : 'You are no longer an organisation member. Sign in again.');
  }
  return role!;
}

async function requireOwnerNow(request: http.IncomingMessage) {
  if ((await roleNow(githubToken(request))) !== 'owner') {
    throw new Refusal(403, 'Only organisation owners can do that.');
  }
}

function hold(request: http.IncomingMessage, user: User, scope: string, role: Role, connection: { on(event: 'close', listener: () => void): unknown }, close: () => void) {
  const token = githubToken(request);
  const entry = { scope, owner: role === 'owner', close };
  const entries = held.get(user.login.toLowerCase()) ?? new Set();
  held.set(user.login.toLowerCase(), entries.add(entry));
  const timer = setInterval(() => {
    void roleNow(token).then((current) => {
      entry.owner = current === 'owner';
      if (!allows(current, user.login, scope)) {
        close();
      }
    });
  }, sessionMs);
  connection.on('close', () => {
    clearInterval(timer);
    entries.delete(entry);
  });
}

async function findContainer(id: string) {
  const container = (await containers()).find((candidate) => candidate.id.startsWith(id));
  if (!container) {
    throw new Refusal(404, 'No such container.');
  }
  return container;
}

async function allProjects() {
  return projects(await containers(), await diskUsage());
}

async function findProject(slug: string) {
  const project = (await allProjects()).find((candidate) => candidate.slug === slug);
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

async function body(request: http.IncomingMessage) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 65_536) {
      throw new Refusal(413, 'The request is too large.');
    }
  }
  return JSON.parse(text || '{}') as unknown;
}

async function members(request: http.IncomingMessage, user: User) {
  const token = githubToken(request);
  const organisation = token ? await organisationMembers(token) : [{ login: user.login, owner: user.owner }];
  const stored = new Map(access.all().map((row) => [row.login, row]));
  return organisation
    .map((member) => ({ ...member, scopes: stored.get(member.login.toLowerCase())?.scopes ?? [], seen: stored.get(member.login.toLowerCase())?.seen ?? null }))
    .sort((a, b) => Number(b.owner) - Number(a.owner) || a.login.localeCompare(b.login));
}

async function api(user: User, request: http.IncomingMessage, url: URL) {
  const route = `${request.method} ${url.pathname}`;
  if (route === 'GET /api/me') {
    access.seen(user.login);
    return { ...user, grants: user.owner ? ['*'] : access.scopes(user.login), ssh: user.owner ? config.sshTarget : null };
  }
  if (route === 'GET /api/docs') {
    return docs();
  }
  if (route === 'GET /api/overview') {
    const [{ host }, usage, list] = await Promise.all([snapshot(), diskUsage(), allProjects()]);
    return {
      host,
      docker: {
        images: usage.images,
        containers: usage.containers,
        buildCache: usage.buildCache,
        volumes: usage.volumes.reduce((sum, volume) => sum + Math.max(0, volume.size), 0),
      },
      projects: list,
    };
  }
  const project = /^GET \/api\/projects\/([a-z0-9-]+)$/.exec(route);
  if (project) {
    const [found, usage] = await Promise.all([findProject(project[1]), diskUsage()]);
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
      const found = await findProject(slug);
      return { ...ranges[range], series: found.containers.map((container) => ({ name: container.service, points: history.series(container.name, range) })) };
    }
    const target = url.searchParams.get('target') ?? '';
    if (target !== 'host' && !(await containers()).some((candidate) => candidate.name === target)) {
      throw new Refusal(404, 'No such container.');
    }
    return { ...ranges[range], series: [{ name: target, points: history.series(target, range) }] };
  }
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
  if (route === 'GET /api/admin/members') {
    if (!user.owner) {
      throw new Refusal(403, 'Only organisation owners can do that.');
    }
    return members(request, user);
  }
  const grant = /^POST \/api\/admin\/members\/([A-Za-z0-9-]+)$/.exec(route);
  if (grant) {
    await requireOwnerNow(request);
    const { scopes } = (await body(request)) as { scopes?: unknown };
    if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === 'string' && scopePattern.test(scope))) {
      throw new Refusal(400, 'Access is a list of *, area:images, area:shell or project:<slug>.');
    }
    access.grant(grant[1], scopes);
    closeRevoked(grant[1]);
    return { ok: true, scopes: access.scopes(grant[1]) };
  }
  if (route === 'POST /api/prune') {
    await requireNow(request, user, 'area:images');
    const result = await docker<{ SpaceReclaimed: number }>('POST', `/images/prune?filters=${encodeURIComponent('{"dangling":["true"]}')}`);
    return { reclaimed: result.SpaceReclaimed };
  }
  const action = /^POST \/api\/containers\/([0-9a-f]{12,64})\/(start|stop|restart)$/.exec(route);
  if (action) {
    const container = await findContainer(action[1]);
    await requireNow(request, user, `project:${container.project}`);
    await docker('POST', `/containers/${container.id}/${action[2]}`);
    await refresh();
    return { ok: true };
  }
  const wake = /^POST \/api\/projects\/([a-z0-9-]+)\/wake$/.exec(route);
  if (wake) {
    await requireNow(request, user, `project:${wake[1]}`);
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
    const file = await readFile(new URL(name, config.webRoot));
    const extension = name.slice(name.lastIndexOf('.'));
    response.writeHead(200, {
      'Content-Type': types[extension] ?? 'application/octet-stream',
      'Cache-Control': name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    response.end(file);
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
    const container = await findContainer(target.container);
    await requireNow(request, user, `project:${container.project}`);
    return open(request, response, target, url.search);
  }
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'POST' && request.headers.origin && request.headers.origin !== new URL(config.appUrl).origin) {
      throw new Refusal(403, 'Cross-origin requests are refused.');
    }
    const result = await api(user, request, url);
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(result));
    return;
  }
  await serveFile(response, url.pathname);
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    const status = error instanceof Refusal ? error.status : error instanceof SyntaxError ? 400 : 500;
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
      const container = await findContainer(target.container);
      const scope = `project:${container.project}`;
      hold(request, user, scope, await requireNow(request, user, scope), socket, () => socket.destroy());
      return openSocket(request, socket, head, target, url.search);
    }
    const found = url.pathname === '/ws/host' ? undefined : await findContainer(url.searchParams.get('container') ?? '');
    const scope = url.pathname === '/ws/host' ? 'area:shell' : url.pathname === '/ws/terminal' ? `project:${found!.project}` : undefined;
    const role = scope ? await requireNow(request, user, scope) : undefined;
    sockets.handleUpgrade(request, socket, head, (client) => {
      if (scope && role) {
        hold(request, user, scope, role, client, () => client.terminate());
      }
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
