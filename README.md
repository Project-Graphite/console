# Project name

One sentence on what this is and who it is for.

## Stack

What it is built with, and anything unusual about how it fits together.

## Running it

```sh
docker compose up
```

Then open http://localhost:8080.

## Layout

| Folder | What it is |
| :--- | :--- |
| `web/` | Replace with the real services |

## Setting up

Delete this section once the checklist is done.

1. Replace the registry entry in `.graphite.yml`, which is the template's own. Set `slug` to the
   lowercase repository name and update `name`, `summary`, `tags`, `owner`, `authors`, `status`,
   `listed`, and `deploy`. Pushing it to `main` registers the project through the Registry workflow.
2. Rename the placeholder service. Every top-level folder containing a `Dockerfile` is a deployable
   service and is built and pushed automatically. Point the docker entry's `directory` in
   `.github/dependabot.yml` at each service folder, one entry per service.
3. Give each service its checks. A folder with a `package.json` gets `npm ci` followed by available
   `lint`, `test`, and `build` scripts. A folder with a `Makefile` must provide `install`, `lint`, and
   `test` targets.
4. Update `compose.yaml` for local development, with its bind mounts, hot reload, and development
   ports. Update `compose.production.yaml` to pull the prebuilt GHCR images,
   define health checks and persistent volumes, avoid published host ports, and cap CPU and memory.
5. Add a screenshot or short GIF, the eventual live link, the stack, and clear local instructions
   to this README.

Use named service folders even for a single-service project. Images are published as
`ghcr.io/project-graphite/<repo>/<service>`, and each image name must match its service in the
production Compose file.

`.github/workflows/pipeline.yml` runs the shared `reusable-pipeline.yml`. Turn a stage off with its
switch, e.g. `with: { changelog: false }`, or replace the file with calls to the individual shared
workflows.

Until the platform entry is merged, the `Deploy` job on `main` fails with a clear message. Builds
and checks continue. Once the repository has the `COOLIFY_WEBHOOK` and `COOLIFY_TOKEN` secrets, the
same job deploys to Coolify.

## Conventions

Pull request titles follow `type(scope): summary` using one of `feat fix chore refactor docs test ci
perf revert style build`. Squash merges put the title into the history of `main`, so the title
matters more than the branch name.
