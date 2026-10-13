# Graphite Console

One web page for the Project Graphite VPS and its handbook. It runs at
`https://console.project-graphite.com` behind Cloudflare Access.

| Page | Shows |
| :--- | :--- |
| Overview | host CPU, memory, swap and disk; host usage charts; storage split into images, volumes, container layers and build cache; one row per project with status, CPU, memory and storage, with a filter and pins |
| Project (`#/project/<slug>`) | a usage chart with a line per container, the containers, and the images and volumes with their sizes |
| Container | a usage chart, details and networks, live logs, a shell, its ports |
| Images, Volumes | every image and volume on the VPS |
| Shell | a root shell on the host |
| Docs | the handbook from the `docs` repository, with search |

Usage charts cover 1h, 5h, 1d, 7d or 30d. Hovering shows the time and every line's value, with the
nearest line highlighted. The chosen range and the pins are kept in the browser.

| Who | Sees | Can |
| :--- | :--- | :--- |
| Organisation owners | everything | start, stop, restart, wake, prune dangling images, container shells, the host shell, open a container's web port |
| Other organisation members | the projects they own or author in the registry: their pages, containers, usage, logs, images and volumes; the Docs | read only |

## Stack

A Node 24 server talks to the Docker Engine API over `/var/run/docker.sock`, reads host usage from
`/proc`, samples every container every 5 seconds in the background, keeps 30 days of per-minute
history in `node:sqlite` (`/data/metrics.db`), reads disk usage every 5 minutes, and serves a React
page built with `@project-graphite/ui`. The handbook is read from GitHub every 5 minutes and
rendered with `marked`; raw HTML in it is shown as text. Terminals are xterm.js over WebSockets into Docker exec sessions. The host
shell is an exec into the console's own container running `nsenter` into the host's PID 1, so the
container runs privileged with `pid: host`.

Sign-in is two layers:

1. **Cloudflare Access** admits only Project-Graphite members. The server verifies the
   `Cf-Access-Jwt-Assertion` header itself.
2. **GitHub sign-in** names the user. An organisation admin is an owner, and anyone else sees only
   their registry projects.

Sessions last 1 hour, after which the page signs in again through GitHub without a prompt. Owner
actions (start, stop, restart, wake, prune, a terminal, the host shell, an open port) ask GitHub for
the user's role before they run, at most once a minute. When that answer is no longer owner, the
action is refused and the user's open terminals close; open terminals are also rechecked every
hour. The session cookie is encrypted and holds the user's GitHub token for these checks.

## Running it

```sh
docker compose up --build
```

Then open http://localhost:3000. Locally there is no Access or GitHub sign-in: `DEV_LOGIN` names
the user and `DEV_ROLE=contributor` shows the contributor view. The local stack talks to your own
Docker, so its shells and actions act on your machine.

For the page with hot reload, keep that container running and serve the page from your machine:

```sh
cd app
npm ci
npm run dev
```

Vite proxies `/api`, `/auth`, `/open` and `/ws` to the container on port 3000, or to
`CONSOLE_ORIGIN` when it is set.

## Commands

| Command | What it does |
| :--- | :--- |
| `npm run build` | Type-check, build the server to `dist/server` and the page to `dist/web` |
| `npm test` | Unit tests |
| `npm run lint` | oxlint |

## Production

`platform/deploy/console/values.yaml` deploys it, proxied through Cloudflare (`proxied: true`), with
the Docker socket and a `data` volume for the history. The values set `NODE_ENV`, `APP_URL` and
`SSH_TARGET`. It needs these values in the `secrets` repository:

| Name | Value |
| :--- | :--- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | a GitHub OAuth App owned by the organisation, callback `https://console.project-graphite.com/auth/callback` |
| `SESSION_SECRET` | 32 or more random bytes, e.g. `openssl rand -base64 48` |
| `ACCESS_TEAM` | the Zero Trust team name, the `<team>` in `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | the Access application's audience tag |

Optional settings, with their defaults: `GITHUB_ORG` (`Project-Graphite`), `REGISTRY_URL` (the
Hub's `registry.json`), `DOCS_REPO` (`project-graphite/docs`), `SABLIER_URL`
(`http://sablier:10000`), `DATA_DIR` (`/data`), `DOCKER_SOCKET` (`/var/run/docker.sock`),
`HOST_ROOT` (`/proc/1/root`).

## API

| Route | Who |
| :--- | :--- |
| `GET /api/me`, `/api/overview`, `/api/projects/<slug>`, `/api/docs` | everyone signed in, scoped to their projects |
| `GET /api/history?target=<container>\|host&range=` or `?project=<slug>&range=` (`1h`, `5h`, `1d`, `7d`, `30d`; default `1d`) | everyone; `host` for owners |
| `GET /api/images`, `GET /api/disk`, `POST /api/prune` | owners |
| `POST /api/containers/<id>/start\|stop\|restart`, `POST /api/projects/<slug>/wake` | owners |
| `/open/<container>/<port>/`, `/ws/terminal`, `/ws/host` | owners |
| `/ws/logs` | everyone, for their containers |
| `/healthz` | anyone |

## Layout

| Path | Purpose |
| :--- | :--- |
| `app/src/server/` | HTTP and WebSocket server (`main`), Docker client, auth, sampling and disk usage (`inventory`), history, host usage from `/proc`, the registry, the handbook (`docs`), `/open` proxy, terminals and logs |
| `app/src/web/` | the React page |
| `app/test/` | unit tests |
| `compose.yaml` | local run against your own Docker |
