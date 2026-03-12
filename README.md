# Grove

Config-driven local Kubernetes development environments.

## What it does

Grove reads a `.grove.yaml` from your repository and manages the full lifecycle of a local Kubernetes development environment: provisioning a Kind or k3s cluster, building and loading Docker images, deploying your Helm chart, forwarding ports, starting frontend dev servers, and watching for file changes to trigger rebuilds. One command — `grove up` — goes from cold start to running environment.

Environments are isolated per feature branch. When you create a workspace with `grove workspace create feature-auth`, Grove sets up git worktrees across all your repos on the same branch and gives each workspace its own Kubernetes namespace and dynamically allocated port block. Multiple environments can run side-by-side without port conflicts or namespace collisions.

This isolation model is designed for AI-driven development, where an agent working on a feature branch needs its own fully functional environment to build, test, and iterate without interfering with the main branch or other in-flight work. Grove provides the infrastructure layer so agents can run `grove up` and have everything they need.

## Key concepts

**Repo** — A git repository registered with Grove. Commands that need a repo context (like `grove up`) auto-detect the current repo from the git root and register it on first use.

**Workspace** — An isolated development context for a feature. Backed by git worktrees, one per repo, all on the same branch. Includes its own Kubernetes namespace and port allocations.

**Environment** — The running state of a workspace: the cluster namespace, deployed Helm release, port forwards, and frontend dev server processes. Managed by `grove up` / `grove down` / `grove destroy`.

**.grove.yaml** — The configuration file at your repo root. Declares services (Docker builds, port forwards, health checks), frontends (dev server commands), Helm chart location, test runner config, and workspace membership.

**Vertical slice** — Grove's internal architecture pattern. Each domain (repo, workspace, environment, testing, etc.) owns its schema, CLI commands, API surface, and tests. See [docs/architecture.md](docs/architecture.md).

## Quick start

Install:

```bash
npm install -g @twiglylabs/grove
```

Initialize and start:

```bash
# From your app repo
grove repo add            # register the current repo
grove up                  # start the environment
grove status              # check what's running
```

Create an isolated workspace for a feature:

```bash
grove workspace create feature-auth
cd $(grove workspace switch feature-auth)
grove up
```

## How it works

Grove reads `.grove.yaml` from your repo root and validates it against a Zod schema. On `grove up`, it:

1. Runs bootstrap checks (copy .env files, install deps, etc.)
2. Provisions the Kind/k3s cluster if it does not exist
3. Creates a Kubernetes namespace named `{project}-{branch}`
4. Builds Docker images for each service with a `build` config
5. Loads images into the cluster
6. Deploys the Helm chart with `helm upgrade --install`
7. Starts port forwards for each service with a `portForward` config
8. Starts configured frontend dev servers as local processes
9. Runs health checks and reports service URLs

Port numbers are allocated dynamically from a block assigned to each worktree. `grove watch` monitors `watchPaths` and triggers image rebuilds and rolling restarts on change.

## CLI reference

| Command | Description |
|---------|-------------|
| `grove up` | Start the development environment |
| `grove down` | Stop all processes |
| `grove destroy` | Stop processes and delete the namespace |
| `grove status` | Show environment state and service URLs |
| `grove watch` | Watch for file changes and rebuild |
| `grove prune` | Clean up orphaned resources |
| `grove reload <service>` | Trigger a manual service rebuild |
| `grove logs <service>` | Stream service logs |
| `grove shell [service]` | Open a shell in a service pod |
| `grove test <platform>` | Run tests (mobile, webapp, api) |
| `grove repo add [path]` | Register a repo |
| `grove repo remove <name>` | Unregister a repo |
| `grove repo list` | List registered repos |
| `grove workspace create <branch>` | Create an isolated workspace |
| `grove workspace list` | List all workspaces |
| `grove workspace status [branch]` | Show workspace details |
| `grove workspace sync <branch>` | Fetch and merge upstream changes |
| `grove workspace close <branch>` | Merge or discard a workspace |
| `grove workspace switch <branch>` | Print workspace root path |
| `grove workspace describe <branch>` | Full environment descriptor (agent handoff) |

See [docs/cli-reference.md](docs/cli-reference.md) for full documentation including flags and examples.

## Documentation

- [Architecture](docs/architecture.md)
- [CLI Reference](docs/cli-reference.md)
- [Configuration](docs/configuration.md)
- [Development](docs/development.md)

## Part of the TwiglyLabs toolchain

Grove is one of five tools built to enable AI-driven software development:

| Tool | Role |
|------|------|
| [Canopy](https://github.com/twiglylabs/canopy) | Workspace dashboard |
| [Trellis](https://github.com/twiglylabs/trellis) | Plan management |
| [Grove](https://github.com/twiglylabs/grove) | Local environments |
| [Bark](https://github.com/twiglylabs/bark) | Quality gates |
| [SAP](https://github.com/twiglylabs/sap) | Session analytics |

Each tool works independently but they compose into a complete workflow.
