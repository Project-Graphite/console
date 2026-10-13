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
| Admin | every organisation member, when they last signed in, and what they can change |
| Docs | the handbook from the `docs` repository, with search |

Usage charts cover 1h, 5h, 1d, 7d or 30d. Hovering shows the time and every line's value, with the
nearest line highlighted. The chosen range and the pins are kept in the browser.

Every organisation member can read everything except Admin. What they can change is set per
member on the Admin page:

| Access | Lets them |
| :--- | :--- |
| a project | start, stop and restart its containers, wake it, open its containers' terminals and ports |
| images | remove dangling images |
| host shell | open the root shell on the host |
| everything | all of the above, for every project |

Organisation owners have everything, and only they see Admin. Access is kept in the console's
`/data/access.db`.

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
2. **GitHub sign-in** names the user. An organisation admin is an owner, and anyone else is a
   member.

Sessions last 1 hour, after which the page signs in again through GitHub without a prompt. Every
change (start, stop, restart, wake, prune, a terminal, the host shell, an open port, saving access)
asks GitHub for the user's role, at most once a minute, and reads their access before it runs. When
they may no longer do it, the change is refused and their open terminals for it close. Removing
access on the Admin page closes those terminals at once, and open terminals are rechecked every
hour. The session cookie is encrypted and holds the user's GitHub token for these checks.

## Running it

```sh
docker compose up --build
```

Then open http://localhost:3000. Locally there is no Access or GitHub sign-in: `DEV_LOGIN` names
the user and `DEV_ROLE=member` shows a member's view. The local stack talks to your own
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

Optional settings, with their defaults: `GITHUB_ORG` (`Project-Graphite`), `DOCS_REPO`
(`project-graphite/docs`), `SABLIER_URL`
(`http://sablier:10000`), `DATA_DIR` (`/data`), `DOCKER_SOCKET` (`/var/run/docker.sock`),
`HOST_ROOT` (`/proc/1/root`).

## API

| Route | Who |
| :--- | :--- |
| `GET /api/me`, `/api/overview`, `/api/projects/<slug>`, `/api/history?target=<container>\|host&range=` or `?project=<slug>&range=` (`1h`, `5h`, `1d`, `7d`, `30d`; default `1d`), `/api/images`, `/api/disk`, `/api/docs`, `/ws/logs` | every member |
| `POST /api/containers/<id>/start\|stop\|restart`, `POST /api/projects/<slug>/wake`, `/open/<container>/<port>/`, `/ws/terminal` | access to the project |
| `POST /api/prune` | access to images |
| `/ws/host` | access to the host shell |
| `GET /api/admin/members`, `POST /api/admin/members/<login>` with `{"scopes": ["project:<slug>", "area:images", "area:shell", "*"]}` | owners |
| `/healthz` | anyone |

## Layout

| Path | Purpose |
| :--- | :--- |
| `app/src/server/` | HTTP and WebSocket server (`main`), Docker client, auth, sampling and disk usage (`inventory`), history, host usage from `/proc`, access (`access`), the handbook (`docs`), `/open` proxy, terminals and logs |
| `app/src/web/` | the React page |
| `app/test/` | unit tests |
| `compose.yaml` | local run against your own Docker |
