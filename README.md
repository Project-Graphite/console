# Graphite Console

One web page for the Project Graphite VPS and its handbook. It runs at
`https://console.project-graphite.com` behind Cloudflare Access.

| Page | Shows |
| :--- | :--- |
| Overview | host CPU, memory, swap and disk; host usage charts; storage split into images, volumes, container layers and build cache; one row per project with status, CPU, memory, storage and a **needs redeploy** hint, with a filter and pins; the last backup run |
| Project (`#/project/<slug>`) | a usage chart with a line per container, the containers, the images and volumes with their sizes; what changed since the last rollout and a Redeploy button; a release control that writes `IMAGE_TAG` or `ENABLED` into `platform`; the project's secrets, for those granted them |
| Container | a usage chart, details and networks, live logs, a shell, its ports |
| Logs | every container's output, collected into the `logs` volume and kept 7 days, with filters |
| Images, Volumes | every image and volume on the VPS; owners can browse and download a volume's files |
| Shell | a root shell on the host |
| Alerts | what needs attention now and what resolved in the last 7 days, and the rules with their thresholds |
| Secrets | owners: every project's secrets, `/<project>/<NAME>`, with create, import, reveal, history and usage |
| Backups | owners: every archive per project, the schedule, run, download, import and restore |
| Admin | every organisation member, when they last signed in, and what they can change |
| Docs | the handbook from the `docs` repository, with search |

Usage charts cover 1h, 5h, 1d, 7d or 30d. Hovering shows the time and every line's value, with the
nearest line highlighted. On the Overview, hovering the VPS chart also breaks that moment's CPU and
memory down by project, largest first, with the rest as system and other; CPU there is a share of
the whole machine. The chosen range and the pins are kept in the browser.

Every organisation member can read everything except Secrets, Backups and Admin. What they can
change is set per member on the Admin page:

| Access | Lets them |
| :--- | :--- |
| a project | start, stop and restart its containers, redeploy it, open its containers' terminals and ports |
| a project's secrets | see and change that project's secrets on its Project page |
| images | remove dangling images |
| host shell | open the root shell on the host |
| everything | all of the above for every project, except secrets, which are granted per project |

Organisation owners have everything, and only they see Admin, Secrets and Backups. Access is kept
in the console's `/data/access.db`.

## Stack

A Node 24 server talks to the Docker Engine API over `/var/run/docker.sock`, reads host usage from
`/proc`, samples every container every 5 seconds in the background, keeps 30 days of per-minute
history in `node:sqlite` (`/data/metrics.db`), reads disk usage every 5 minutes, follows every
container's logs into `/logs/logs.db`, and serves a React page built with `@project-graphite/ui`.
The handbook is read from GitHub every 5 minutes and rendered with `marked`; raw HTML in it is
shown as text. Terminals are xterm.js over WebSockets into Docker exec sessions. The host shell is
an exec into the console's own container running `nsenter` into the host's PID 1, so the container
runs privileged with `pid: host`.

**Secrets** are AES-256-GCM rows in `/data/secrets.db`, encrypted with `SECRETS_KEY`, one version
per change, with an audit table. Every save rewrites `/etc/graphite/<project>.env` on the host
atomically, mode 600, through the host root; `docker compose` reads that file at the project's next
rollout. On start the store re-encrypts anything on an older key and reads every env file on the
host back in, so a value edited over SSH becomes a version. The console's own `console.env` is the
one file it refuses to manage. A project whose env file is newer than its `.applied` marker shows
**needs redeploy**; Redeploy runs `/srv/graphite/bin/graphite-up <project>` on the host as a
transient systemd unit and streams its log.

**Backups** are read from `/var/lib/graphite/backups/`, where the platform's backup service writes
one verified tar and a JSON summary per project and run. The page orders a run, a verification or a
restore by dropping a request file under `.requests/`, which the service picks up; download streams
the tar, import uploads one and orders its verification, and the schedule is `.schedule.json`. Every
action is appended to `audit.log` there.

**The Hub.** When `DEPLOY_REPORT_SECRET` is set the console reads the Hub's `/health/ready` and
signed `/internal/metrics` every minute for the Alerts page. Releases from the Project page commit
to `platform` through the platform GitHub App.

Sign-in is two layers:

1. **Cloudflare Access** admits only Project-Graphite members. The server verifies the
   `Cf-Access-Jwt-Assertion` header itself.
2. **GitHub sign-in** names the user. An organisation admin is an owner, and anyone else is a
   member.

Sessions last 1 hour, after which the page signs in again through GitHub without a prompt. Every
change (start, stop, restart, redeploy, prune, a terminal, the host shell, an open port, saving
access, anything on Secrets or Backups) asks GitHub for the user's role, at most once a minute, and
reads their access before it runs. When they may no longer do it, the change is refused and their
open terminals for it close. Removing access on the Admin page closes those terminals at once, and
open terminals are rechecked every hour. The session cookie is encrypted and holds the user's
GitHub token for these checks.

## Running it

```sh
docker compose up --build
```

Then open http://localhost:3000. Locally there is no Access or GitHub sign-in: `DEV_LOGIN` names
the user and `DEV_ROLE=member` shows a member's view. The local stack talks to your own Docker, so
its shells and actions act on your machine, and its `SECRETS_KEY` is a fixed all-zero key for the
local store only.

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

`platform/deploy/console/compose.yaml` deploys it, proxied through Cloudflare (`PROXIED=true` in
its `values`), with the Docker socket, `pid: host`, a `data` volume that is in the nightly backup
and a `logs` volume. Its own secrets are the one env file the store does not write: an owner places
`/etc/graphite/console.env` on the VPS by hand, mode 600, with:

| Name | Value |
| :--- | :--- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | a GitHub OAuth App owned by the organisation, callback `https://console.project-graphite.com/auth/callback` |
| `SESSION_SECRET` | 32 or more random bytes, e.g. `openssl rand -base64 48` |
| `ACCESS_TEAM` | the Zero Trust team name, the `<team>` in `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | the Access application's audience tag |
| `SECRETS_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`); `new,old` during a rotation. Without it the Secrets page answers 503 |
| `ALERTS_TOKEN` | optional: a fine-grained token with Issues read and write on `platform`, for alert issues |
| `SMTP_URL`, `ALERTS_FROM`, `ALERTS_EMAIL` | optional: alert emails |
| `PLATFORM_APP_CLIENT_ID`, `PLATFORM_APP_PRIVATE_KEY` | optional: releases from the Project page |
| `DEPLOY_REPORT_SECRET` | optional: the same value as the agent's and the Hub's, for the Hub's metrics |

Other settings, with their defaults: `ALERTS_REPO` (`project-graphite/platform`), `GITHUB_ORG`
(`Project-Graphite`), `DOCS_REPO` (`project-graphite/docs`), `PLATFORM_REPO`
(`project-graphite/platform`), `SABLIER_URL` (`http://sablier:10000`), `DATA_DIR` (`/data`),
`LOGS_DIR` (`/logs`), `LOGS_KEEP_DAYS` (`7`), `DOCKER_SOCKET` (`/var/run/docker.sock`),
`HOST_ROOT` (`/proc/1/root`), `GRAPHITE_HOME` (`/srv/graphite`), `SSH_TARGET`.

## Alerts

Every minute the console checks host CPU, memory, swap and disk, a container that stopped, is
unhealthy, exceeds its CPU or memory limit or restarted three times in ten minutes (noting an
out-of-memory kill), a project with no verified backup in 26 hours or whose last backup failed, and
the Hub's error rate and readiness. Each rule's threshold and duration can be changed or disabled
on the Alerts page. A condition becomes an alert after holding for its duration and resolves after
a clear minute. Active alerts show on the Overview and the Alerts tab, and history is kept in
`/data/alerts.db` for 30 days.

With `ALERTS_TOKEN` set, each alert also opens an issue labelled `alert` in `ALERTS_REPO` and
closes it on recovery, so GitHub's notifications deliver it. With `SMTP_URL`, `ALERTS_FROM` and
`ALERTS_EMAIL` set, each alert and resolution is also emailed, and the Alerts page has a test send.
`platform`'s **Uptime** workflow raises the same kind of issue from outside the VPS.

## API

| Route | Who |
| :--- | :--- |
| `GET /api/me`, `/api/overview`, `/api/projects/<slug>`, `/api/history?target=<container>\|host&range=` or `?project=<slug>&range=` (`1h`, `5h`, `1d`, `7d`, `30d`; default `1d`), `/api/images`, `/api/disk`, `/api/alerts`, `/api/logs`, `/api/logs/sources`, `/api/docs`, `/ws/logs` | every member |
| `POST /api/containers/<id>/start\|stop\|restart`, `GET\|POST /api/projects/<slug>/redeploy`, `/open/<container>/<port>/`, `/ws/terminal` | access to the project |
| `GET\|POST /api/secrets/<project>[/<NAME>[/reveal\|/restore]\|/import\|/delete]` | access to the project's secrets |
| `POST /api/prune` | access to images |
| `/ws/host` | access to the host shell |
| `GET /api/secrets`, `GET /api/backups`, `POST /api/backups/schedule`, `POST /api/backups/<project>/run`, `GET /api/backups/<project>/<stamp>.tar`, `POST /api/backups/<project>/import`, `POST /api/backups/<project>/<stamp>/restore`, `GET\|POST /api/projects/<slug>/release\|enabled`, `POST /api/alerts/rules/<kind>`, `POST /api/alerts/test`, `POST /api/volumes`, `/api/volumes/<name>/files\|file\|delete`, `GET /api/admin/members`, `POST /api/admin/members/<login>` with `{"scopes": ["project:<slug>", "secrets:<slug>", "area:images", "area:shell", "*"]}` | owners |
| `/healthz` | anyone |

## Layout

| Path | Purpose |
| :--- | :--- |
| `app/src/server/` | HTTP and WebSocket server (`main`), Docker client, auth, sampling and disk usage (`inventory`), history, host usage from `/proc`, access (`access`), alerts (`alerts`, `monitor`, `hub`), the secret store (`secrets`), backups (`backups`), rollouts and redeploys (`rollout`, `platform`), the log store (`logstore`), the handbook (`docs`), `/open` proxy, terminals and logs |
| `app/src/web/` | the React page |
| `app/test/` | unit tests |
| `compose.yaml` | local run against your own Docker |
