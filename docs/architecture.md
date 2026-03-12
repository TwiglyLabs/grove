# Grove Architecture

## Overview

Grove uses a **vertical slice architecture**. Each domain owns its schema, commands, API surface, and tests. There is no horizontal layering — no shared services layer, no shared repository layer. A domain slice is complete in itself.

## Directory Structure

```
src/
  shared/           Cross-cutting infrastructure (identity, errors, output, config loader)
  repo/             Repo registry management
  workspace/        Multi-repo workspace operations
  environment/      Environment lifecycle (up, down, destroy, watch, status, prune, reload)
  testing/          Test runner and result parsing
  simulator/        iOS simulator management
  shell/            Shell into service pods
  logs/             Log streaming
  config.ts         Root config compositor — composes zod schemas from all slices
  cli.ts            Commander CLI skeleton — imports slice cli.ts files and registers commands
  lib.ts            Public library API — re-exports types and namespaces from all slices
  index.ts          CLI entry point (parses args via Commander)
```

## Slice Structure

Each slice follows a consistent internal pattern:

| File | Purpose |
|------|---------|
| `types.ts` | Domain types, zod schemas, interfaces |
| `api.ts` | Public API functions |
| `cli.ts` | CLI command registration (imported by `src/cli.ts`) |
| `config.ts` | Zod schema fragment (imported by `src/config.ts`) |
| `*.test.ts` | Colocated unit and integration tests |

## Domains

### shared

Cross-cutting infrastructure used by all other slices. Not a domain in the business sense — it is a collection of primitives.

- **`identity.ts`** — `RepoId` and `WorkspaceId` branded string types. Generated via `nanoid`. Consumers must not construct or parse these directly.
- **`errors.ts`** — `GroveError` base class and typed subclasses (`RepoNotFoundError`, `ConfigNotFoundError`, `HealthCheckFailedError`, etc.). All errors carry a `code` string for programmatic matching.
- **`output.ts`** — Chalk formatting helpers (`printInfo`, `printSuccess`, `printError`, `printWarning`, `printBanner`, `printDashboard`, etc.).
- **`config.ts`** — Config loader that accepts a `RepoId`, resolves the filesystem path via the repo registry, and delegates to `src/config.ts`.

### repo

Manages the global repo registry. A repo entry associates a `RepoId` with a filesystem path and a human-readable name. Commands that need a repo context call `resolveCurrentRepo()` in `src/cli.ts`, which finds the git root, looks up the registry, and auto-registers if the repo is new.

Key operations: `add`, `remove`, `list`, `findByPath`, `resolveRepoPath`.

### workspace

Manages multi-repo workspaces backed by git worktrees. A workspace bundles one or more repos on a shared branch name, with a parent worktree containing child worktrees in a nested layout.

Workspace state (id, branch, root, repos, status) is persisted to `~/.grove/workspaces/`. The `GROVE_STATE_DIR` environment variable overrides the default.

Worktree directories default to `~/worktrees/` and are overridden by `GROVE_WORKTREE_DIR`.

Key operations: `create`, `list`, `status`, `sync`, `close`, `switch`, `describe`.

### environment

Manages the full lifecycle of a local Kubernetes environment for a single repo. Reads `.grove.yaml`, runs preflight checks, provisions a Kind/k3s cluster and namespace, builds and loads Docker images, deploys via Helm, forwards ports, starts frontend dev servers, and runs file watchers for hot-rebuild.

Environment state (namespace, port allocations, process PIDs) is persisted per worktree.

Key operations: `up`, `down`, `destroy`, `status`, `watch`, `prune`, `reload`.

### testing

Runs tests against the active environment. Supports three platforms: `mobile` (Maestro), `webapp`, and `api`. Parses test results into a structured `TestResult` type and writes history to `.grove/test-history/`.

Key operations: `run`, accessed via `grove test <platform>`.

### simulator

Manages iOS simulators for mobile development. Handles simulator lifecycle (boot, install, launch) alongside the environment. Configured via the `simulator` section of `.grove.yaml`.

### shell

Opens an interactive shell in a running service pod via `kubectl exec`. Shell targets can be configured in `.grove.yaml` under `utilities.shellTargets` with a custom pod selector and shell binary.

Key operations: `shell`, accessed via `grove shell [service]`.

### logs

Streams logs from a running service. Supports both file-backed log streaming and live kubectl pod logs via the `--pod` flag.

Key operations: `logs`, accessed via `grove logs <service>`.

## Root Config Compositor (`src/config.ts`)

The root config is not owned by any single slice. `src/config.ts` composes zod schema fragments from each slice into the full `GroveConfigSchema`:

```typescript
export const GroveConfigSchema = z.object({
  project: ProjectSchema,           // environment slice
  helm: HelmSchema,                 // environment slice
  services: z.array(ServiceSchema), // environment slice
  frontends: z.array(FrontendSchema).optional(),
  bootstrap: z.array(BootstrapStepSchema).optional(),
  testing: TestingSchema.optional(),      // testing slice
  simulator: SimulatorSchema.optional(),  // simulator slice
  utilities: UtilitiesSchema.optional(),  // shell + environment slices
  workspace: WorkspaceConfigSchema.optional(), // workspace slice
  hooks: EnvironmentHooksSchema.optional(),    // environment slice
});
```

Slices own their schema fragments. The compositor owns only the top-level assembly.

## CLI (`src/cli.ts`)

Commander-based program. Each slice's `cli.ts` exports a command registration function that is imported and called by `src/cli.ts`. The root CLI owns no business logic — it resolves the current repo via `resolveCurrentRepo()` and delegates to slice commands.

`resolveCurrentRepo()` finds the git root of the current directory, looks it up in the repo registry, and auto-registers it if not found.

## Library API (`src/lib.ts`)

Public entry point for `@twiglylabs/grove` when used as a Node.js library. Re-exports types and namespace objects from all slices:

```typescript
import { environment, workspace, repo } from '@twiglylabs/grove'

const result = await environment.up(repoId, options)
const workspaces = await workspace.list(options)
const entry = await repo.add('/path/to/repo')
```

## State Files

Grove persists state in two locations:

| Location | Contents |
|----------|---------|
| `~/.grove/repos/` | Repo registry (one JSON file per repo) |
| `~/.grove/workspaces/` | Workspace state (one JSON file per workspace) |
| `<repo>/.grove/state/` | Environment state per worktree (port allocations, PIDs, namespace) |

State directories are overridden by the `GROVE_STATE_DIR` environment variable.
