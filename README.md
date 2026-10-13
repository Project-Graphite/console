# Graphite Console

One web page for the Project Graphite VPS: every project's containers, images and volumes, live
and 24-hour CPU and memory, host disk and swap, live logs, container shells and a root shell on
the host. It runs at `https://console.project-graphite.com` behind Cloudflare Access.

| Who | Sees | Can |
| :--- | :--- | :--- |
| Organisation owners | everything: host, every project, images, volumes | start, stop, restart, wake, prune dangling images, container shells, the host shell, open a container's web port |
| Other organisation members | containers of the projects they own or author in the registry | read state, usage, history and logs |

## Stack

A Node 24 server talks to the Docker Engine API over `/var/run/docker.sock`, reads host usage from
`/proc`, keeps 24 hours of samples in `node:sqlite`, and serves a React page built with
`@project-graphite/ui`. Terminals are xterm.js over WebSockets into Docker exec sessions. The host
shell is an exec into the console's own container running `nsenter` into the host's PID 1, so the
container runs privileged with `pid: host`.

Sign-in is two layers:

1. **Cloudflare Access** admits only Project-Graphite members. The server verifies the
   `Cf-Access-Jwt-Assertion` header itself.
2. **GitHub sign-in** names the user. An organisation admin is an owner, and anyone else sees only
   their registry projects.

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

Vite proxies `/api`, `/auth`, `/open` and `/ws` to the container on port 3000.

## Commands

| Command | What it does |
| :--- | :--- |
| `npm run build` | Type-check, build the server to `dist/server` and the page to `dist/web` |
| `npm test` | Unit tests |
| `npm run lint` | oxlint |

## Production

`platform/deploy/console/values.yaml` deploys it. It needs these values in the `secrets`
repository:

| Name | Value |
| :--- | :--- |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | a GitHub OAuth App owned by the organisation, callback `https://console.project-graphite.com/auth/callback` |
| `SESSION_SECRET` | 32 or more random bytes, e.g. `openssl rand -base64 48` |
| `ACCESS_TEAM` | the Zero Trust team name, the `<team>` in `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | the Access application's audience tag |

## Layout

| Path | Purpose |
| :--- | :--- |
| `app/src/server/` | HTTP and WebSocket server, Docker client, auth, history |
| `app/src/web/` | the React page |
| `app/test/` | unit tests |
| `compose.yaml` | local run against your own Docker |
