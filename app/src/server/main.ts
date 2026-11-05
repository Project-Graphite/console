import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Access, permits, scopePattern } from './access.ts';
import { Alerts, ruleKinds, type RuleKind } from './alerts.ts';
import { authenticate, callback, githubToken, login, logout, organisationMembers, roleNow, sessionMs, type Role, type User } from './auth.ts';
import { download, listBackups, nextRun, order, readSchedule, requests, upload, writeSchedule } from './backups.ts';
import { config } from './config.ts';
import { docker } from './docker.ts';
import { docs } from './docs.ts';
import { History, projectTotals, ranges, type Range } from './history.ts';
import { collect, containers, diskUsage, projects, refresh, refreshDisk, snapshot, type ContainerView } from './inventory.ts';
import { serve as serveLive } from './live.ts';
import { email, emailing, monitor } from './monitor.ts';
import { open, openSocket, parseOpen } from './proxy.ts';
import { Refusal } from './refusal.ts';
import { appliedAt, appliedCompose, appliedValueNames, redeployStatus, startRedeploy } from './rollout.ts';
import { composeReferences, parseKeys, projectPattern, SecretStore } from './secrets.ts';
import { LogStore } from './logstore.ts';
import { hostShell, type ShellMode } from './shell.ts';
import { createVolume, downloadFile, listFiles, removeVolume } from './volumes.ts';
import { downloadLogs, logs, terminal } from './terminal.ts';

const history = new History(config.dataDir);
const access = new Access(config.dataDir);
const alerts = new Alerts(config.dataDir);
const store = config.secretsKey ? new SecretStore(config.dataDir, parseKeys(config.secretsKey), path.join(config.hostRoot, 'etc/graphite')) : undefined;
const logStore = new LogStore(config.logsDir, config.logsKeepDays);
collect(history);
monitor(alerts);
logStore.start(containers);

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

function secretStore() {
  if (!store) {
    throw new Refusal(503, "The secret store needs SECRETS_KEY in the console's env file.");
  }
  return store;
}

async function needsRedeploy(project: string, views: ContainerView[]) {
  const changed = store?.changedAt(project) ?? null;
  const created = views.filter((view) => view.project === project).map((view) => view.created);
  return changed !== null && created.length > 0 && changed > Math.max(...created, (await appliedAt(project)) ?? 0);
}

async function secretProject(project: string) {
  const [compose, values] = await Promise.all([appliedCompose(project), appliedValueNames(project)]);
  const stored = new Set(secretStore().list(project).map((secret) => secret.name));
  return {
    project,
    missing: [...composeReferences(compose)].filter(([name, reference]) => reference.required && !stored.has(name) && !values.has(name)).map(([name]) => name),
  };
}

async function secretsApi(user: User, request: http.IncomingMessage, route: string) {
  const secrets = secretStore();
  if (route === 'GET /api/secrets') {
    await requireOwnerNow(request);
    const views = await containers();
    const slugs = new Set([...secrets.projects(), ...views.map((view) => view.project)].filter((slug) => projectPattern.test(slug) && slug !== 'console' && slug !== 'other'));
    return { projects: await Promise.all([...slugs].sort().map((slug) => secretProject(slug))), secrets: secrets.list() };
  }
  const match = /^(GET|POST) \/api\/secrets\/([a-z0-9-]+)(?:\/([A-Z_][A-Z0-9_]*|import|delete))?(?:\/(reveal|restore))?$/.exec(route);
  if (!match) {
    throw new Refusal(404, 'Not found.');
  }
  const [, method, project, target, action] = match;
  await requireNow(request, user, `secrets:${project}`);
  if (method === 'GET' && !target) {
    return { project: await secretProject(project), secrets: secrets.list(project) };
  }
  if (method === 'GET' && !action && /^[A-Z_]/.test(target)) {
    return { ...secrets.detail(project, target), file: `${project}/compose.yaml`, usage: composeReferences(await appliedCompose(project)).get(target)?.lines ?? [] };
  }
  if (method !== 'POST') {
    throw new Refusal(404, 'Not found.');
  }
  if (!target) {
    secrets.create(project, await body(request), user.login);
    return { ok: true };
  }
  if (target === 'import' && !action) {
    const { text, preview } = (await body(request)) as { text?: unknown; preview?: unknown };
    if (typeof text !== 'string') {
      throw new Refusal(400, 'Paste the NAME=value lines to import.');
    }
    return { names: secrets.importText(project, text, preview === true, user.login) };
  }
  if (target === 'delete' && !action) {
    const { names } = (await body(request)) as { names?: unknown };
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
      throw new Refusal(400, 'Name the secrets to delete.');
    }
    const references = composeReferences(await appliedCompose(project));
    const required = names.filter((name: string) => references.get(name)?.required);
    if (required.length) {
      throw new Refusal(409, `${project}/compose.yaml still requires ${required.join(', ')}.`);
    }
    secrets.remove(project, names, user.login);
    return { ok: true };
  }
  if (!action) {
    secrets.update(project, target, await body(request), user.login);
    return { ok: true };
  }
  if (action === 'reveal') {
    return { value: secrets.reveal(project, target, user.login) };
  }
  const { version } = (await body(request)) as { version?: unknown };
  if (!Number.isInteger(version)) {
    throw new Refusal(400, 'Name the version to restore.');
  }
  secrets.restore(project, target, version as number, user.login);
  return { ok: true };
}

async function api(user: User, request: http.IncomingMessage, url: URL) {
  const route = `${request.method} ${url.pathname}`;
  if (url.pathname.startsWith('/api/secrets')) {
    return secretsApi(user, request, route);
  }
  if (route === 'GET /api/backups') {
    if (!user.owner) {
      throw new Refusal(403, 'Only organisation owners can do that.');
    }
    const [projects, schedule, recent] = await Promise.all([listBackups(), readSchedule(), requests()]);
    return { projects, schedule, next: schedule.enabled ? nextRun(schedule, Date.now()) : null, requests: recent };
  }
  if (route === 'POST /api/backups/schedule') {
    await requireOwnerNow(request);
    await writeSchedule(await body(request), user.login);
    return { ok: true };
  }
  const backup = /^POST \/api\/backups\/([a-z0-9][a-z0-9_-]*)\/(?:run|(\d{8}T\d{6}Z)\/restore)$/.exec(route);
  if (backup) {
    await requireOwnerNow(request);
    return { id: backup[2] ? await order('restore', backup[1], user.login, `${backup[2]}.tar`) : await order('run', backup[1], user.login) };
  }
  if (route === 'GET /api/me') {
    access.seen(user.login);
    return { ...user, grants: user.owner ? ['*'] : access.scopes(user.login), ssh: user.owner ? config.sshTarget : null };
  }
  if (route === 'GET /api/alerts') {
    return {
      active: alerts.active(),
      recent: alerts.recent(),
      notifying: Boolean(config.alertsToken),
      emailing: emailing(),
      repo: config.alertsRepo,
      rules: Object.values(alerts.rules()).map((rule) => ({ ...ruleKinds[rule.kind], ...rule })),
    };
  }
  const rule = /^POST \/api\/alerts\/rules\/([a-z-]+)$/.exec(route);
  if (rule) {
    await requireOwnerNow(request);
    if (!(rule[1] in ruleKinds)) {
      throw new Refusal(404, `There is no ${rule[1]} rule.`);
    }
    const { threshold, minutes, enabled } = (await body(request)) as { threshold?: unknown; minutes?: unknown; enabled?: unknown };
    const number = (value: unknown, most: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= most;
    if (!number(threshold, 100_000) || !number(minutes, 1440) || typeof enabled !== 'boolean') {
      throw new Refusal(400, 'A rule needs a threshold, minutes between 0 and 1440, and enabled.');
    }
    alerts.setRule({ kind: rule[1] as RuleKind, threshold: threshold as number, minutes: minutes as number, enabled });
    return { ok: true };
  }
  if (route === 'POST /api/alerts/test') {
    await requireOwnerNow(request);
    await email('Test alert from the Graphite console', `${user.login} sent this test from ${config.appUrl}/#/alerts.`);
    return { ok: true };
  }
  if (route === 'GET /api/logs') {
    const list = (name: string) => url.searchParams.get(name)?.split(',').filter(Boolean);
    const number = (name: string) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined);
    const since = { '15m': 900_000, '1h': 3600_000, '6h': 21_600_000, '24h': 86_400_000, '7d': 604_800_000 }[url.searchParams.get('since') ?? ''];
    return logStore.query({
      projects: list('projects'),
      containers: list('containers'),
      streams: list('streams'),
      levels: list('levels'),
      text: url.searchParams.get('q')?.trim() || undefined,
      from: since ? Date.now() - since : undefined,
      before: number('before'),
      after: number('after'),
      limit: number('limit'),
    });
  }
  if (route === 'GET /api/logs/sources') {
    return { sources: logStore.sources(), ...logStore.stats(), keepDays: config.logsKeepDays };
  }
  if (route === 'GET /api/docs') {
    return docs();
  }
  if (route === 'GET /api/overview') {
    const [{ host }, usage, list, backups] = await Promise.all([snapshot(), diskUsage(), allProjects(), listBackups()]);
    const latest = backups.flatMap(({ archives }) => archives.filter((archive) => !archive.imported).slice(0, 1));
    return {
      backups: { projects: latest.length, verified: latest.filter((archive) => archive.ok).length, latest: latest.map((archive) => archive.stamp).sort().at(-1) ?? null },
      host,
      docker: {
        images: usage.images,
        containers: usage.containers,
        buildCache: usage.buildCache,
        volumes: usage.volumes.reduce((sum, volume) => sum + Math.max(0, volume.size), 0),
      },
      projects: await Promise.all(list.map(async (project) => ({ ...project, needsRedeploy: await needsRedeploy(project.slug, project.containers) }))),
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
    const series = [{ name: target === 'host' ? 'VPS' : target, points: history.series(target, range) }];
    if (target === 'host' && url.searchParams.get('breakdown') === 'projects') {
      const [{ host }, views] = await Promise.all([snapshot(), containers()]);
      return { ...ranges[range], series, breakdown: projectTotals(views, (name) => history.series(name, range), host.cpus) };
    }
    return { ...ranges[range], series };
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
      throw new Refusal(400, 'Access is a list of *, area:images, area:shell, project:<slug> or secrets:<slug>.');
    }
    access.grant(grant[1], scopes);
    closeRevoked(grant[1]);
    return { ok: true, scopes: access.scopes(grant[1]) };
  }
  if (route === 'POST /api/volumes') {
    await requireOwnerNow(request);
    await createVolume(((await body(request)) as { name?: unknown }).name);
    await refreshDisk();
    return { ok: true };
  }
  const volume = /^(GET|POST) \/api\/volumes\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/(files|delete)$/.exec(route);
  if (volume) {
    await requireOwnerNow(request);
    if (volume[1] === 'GET' && volume[3] === 'files') {
      return listFiles(volume[2], url.searchParams.get('path') ?? '');
    }
    if (volume[1] === 'POST' && volume[3] === 'delete') {
      await removeVolume(volume[2]);
      await refreshDisk();
      return { ok: true };
    }
  }
  if (route === 'POST /api/prune') {
    await requireNow(request, user, 'area:images');
    const result = await docker<{ SpaceReclaimed: number; ImagesDeleted: { Deleted?: string }[] | null }>(
      'POST',
      `/images/prune?filters=${encodeURIComponent('{"dangling":["false"]}')}`,
    );
    await refreshDisk();
    return { reclaimed: result.SpaceReclaimed, removed: (result.ImagesDeleted ?? []).filter((entry) => entry.Deleted).length };
  }
  const action = /^POST \/api\/containers\/([0-9a-f]{12,64})\/(start|stop|restart)$/.exec(route);
  if (action) {
    const container = await findContainer(action[1]);
    await requireNow(request, user, `project:${container.project}`);
    await docker('POST', `/containers/${container.id}/${action[2]}`);
    await refresh();
    return { ok: true };
  }
  const redeploy = /^(GET|POST) \/api\/projects\/([a-z0-9-]+)\/redeploy$/.exec(route);
  if (redeploy) {
    if (redeploy[1] === 'GET') {
      return redeployStatus(redeploy[2]);
    }
    await requireNow(request, user, `project:${redeploy[2]}`);
    await startRedeploy(redeploy[2]);
    store?.audit(user.login, 'redeploy', redeploy[2], null);
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
    });
    response.end(file);
  } catch {
    response.writeHead(404).end('Not found.');
  }
}

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ...(config.production ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
};

function sameOrigin(request: http.IncomingMessage) {
  const origin = request.headers.origin;
  return origin ? origin === new URL(config.appUrl).origin : request.headers['sec-fetch-site'] === 'same-origin';
}

async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
  const url = new URL(request.url ?? '/', config.appUrl);
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
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
  if (url.pathname === '/api/live' && request.method === 'GET') {
    const token = githubToken(request);
    return serveLive(request, response, async () => (await roleNow(token)) !== undefined);
  }
  const logFile = /^\/api\/containers\/([0-9a-f]{12,64})\/logs$/.exec(url.pathname);
  if (logFile && request.method === 'GET') {
    return downloadLogs(response, await findContainer(logFile[1]));
  }
  const volumeFile = /^\/api\/volumes\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/file$/.exec(url.pathname);
  if (volumeFile && request.method === 'GET') {
    await requireOwnerNow(request);
    return downloadFile(response, volumeFile[1], url.searchParams.get('path') ?? '');
  }
  const archive = /^\/api\/backups\/([a-z0-9][a-z0-9_-]*)\/(\d{8}T\d{6}Z)\.tar$/.exec(url.pathname);
  if (archive && request.method === 'GET') {
    await requireOwnerNow(request);
    return download(response, archive[1], archive[2], user.login);
  }
  if (url.pathname.startsWith('/api/')) {
    if (request.method !== 'GET' && !sameOrigin(request)) {
      throw new Refusal(403, 'Cross-origin requests are refused.');
    }
    const importing = /^\/api\/backups\/([a-z0-9][a-z0-9_-]*)\/import$/.exec(url.pathname);
    if (importing && request.method === 'POST') {
      await requireOwnerNow(request);
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(await upload(request, importing[1], user.login)));
      return;
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
    const mode: ShellMode = url.searchParams.get('mode') === 'root' ? 'root' : 'operator';
    const scope = url.pathname === '/ws/host' ? (mode === 'root' ? 'owner:shell' : 'area:shell') : url.pathname === '/ws/terminal' ? `project:${found!.project}` : undefined;
    const role = scope ? await requireNow(request, user, scope) : undefined;
    const host = url.pathname === '/ws/host' ? await hostShell(mode, user.login) : undefined;
    if (host) {
      console.log(`${user.login} opened a ${mode} host shell`);
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      if (scope && role) {
        hold(request, user, scope, role, client, () => client.terminate());
      }
      const run =
        url.pathname === '/ws/logs'
          ? logs(client, found!.id, url.searchParams)
          : url.pathname === '/ws/terminal'
            ? terminal(client, { container: found!.id })
            : host
              ? terminal(client, { host })
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
