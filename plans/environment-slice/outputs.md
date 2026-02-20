## Public API

`src/environment/api.ts` exports:
- `up(repoId: RepoId, opts?: UpOptions): Promise<UpResult>`
- `down(repoId: RepoId): Promise<DownResult>`
- `destroy(repoId: RepoId): Promise<DestroyResult>`
- `status(repoId: RepoId): Promise<DashboardData>`
- `watch(repoId: RepoId): WatchHandle`
- `prune(repoId: RepoId): Promise<PruneResult>`

## Types

`src/environment/types.ts` exports: `EnvironmentState`, `ProcessInfo`, `UpOptions`, `UpResult`, `DownResult`, `DestroyResult`, `DashboardData`, `WatchHandle`, `PruneResult`.

## Config schemas

`src/environment/config.ts` exports zod schemas for: project, helm, services (with build, portForward, health), frontends, bootstrap. These compose into the root config.

## State access

`src/environment/state.ts` exports `readState(config)` — used by testing, shell, logs, and simulator slices to access current environment state (ports, URLs, namespace).

## CLI subcommands

`src/environment/cli.ts` exports commander commands for `grove up`, `grove down`, `grove destroy`, `grove status`, `grove watch`, `grove prune`.
