---
title: 'Environment Slice: K8s Orchestration'
status: not_started
depends_on:
  - foundation
description: >-
  Migrate K8s environment orchestration (up/down/destroy, state, processes,
  health, cluster, bootstrap, watcher) into vertical slice
tags:
  - slice
not_started_at: '2026-02-20T05:15:42.029Z'
---

## Problem

The K8s environment orchestration is the original core of grove and the most sprawling part of the codebase. It's scattered across the `src/` root: `controller.ts` (the ensure/up flow), `state.ts` (port allocation, environment state, locking), `cluster.ts`, `bootstrap.ts`, `health.ts`, `watcher.ts`, `prune.ts`, `timing.ts`, plus `src/processes/` and `src/frontends/`. These files have tight coupling through shared types and state, but no explicit boundary.

## Approach
**Consolidate into `src/environment/`.** This is the largest slice, with internal structure:

- `src/environment/types.ts` — `EnvironmentState`, `ProcessInfo`, `UpOptions`, `UpResult`, `DownResult`, `DestroyResult`, `DashboardData`, `WatchHandle`, `PruneResult`, `EnvironmentEvents`, `EnvironmentPhase`
- `src/environment/state.ts` — port allocation, state file I/O, locking (from current `state.ts`)
- `src/environment/controller.ts` — the `ensureEnvironment()` orchestration flow
- `src/environment/cluster.ts` — kind cluster management
- `src/environment/bootstrap.ts` — pre-flight bootstrap checks and fixes
- `src/environment/health.ts` — health check polling
- `src/environment/watcher.ts` — chokidar file watching and rebuild triggering
- `src/environment/prune.ts` — orphaned resource cleanup
- `src/environment/template.ts` — env var template resolution (`{{ports.X}}`, `{{urls.X}}`) from current `src/template.ts`
- `src/environment/processes/` — `BuildOrchestrator`, `PortForwardProcess`
- `src/environment/frontends/` — `GenericDevServer`
- `src/environment/config.ts` — owns the config schema sections: project, helm, services, frontends, bootstrap, reloadTargets (from utilities)
- `src/environment/api.ts` — public API: `up()`, `down()`, `destroy()`, `status()`, `watch()`, `reload()`, `prune()`
- `src/environment/cli.ts` — commander subcommands: `up`, `down`, `destroy`, `status`, `watch`, `reload`, `prune`
- `src/environment/*.test.ts` — colocated tests

**Config ownership.** The environment slice owns the largest chunk of `.grove.yaml` schema: project, helm, services, frontends, bootstrap. These zod schemas move from the root `config.ts` into `src/environment/config.ts` and are composed back into the root config. The `reloadTargets` array from the current `UtilitiesSchema` also belongs here (alongside `shellTargets` which goes to the shell slice in satellite-slices).

**Event callbacks.** `EnvironmentEvents` and `EnvironmentPhase` (from `src/api/events.ts`) move into `src/environment/types.ts`. These are environment-specific callback interfaces.

**Reload command.** `src/commands/reload.ts` provides `grove reload <service>` — it signals the running watcher by writing `.reload-request`. This moves to `src/environment/cli.ts` (as a subcommand) with the logic in `src/environment/api.ts`.

**Template resolution.** `src/template.ts` provides `resolveTemplates(env, state)` for `{{ports.X}}`/`{{urls.X}}` substitution in env var values. It operates on `EnvironmentState` and belongs in this slice.

**Delete old root files.** Remove `controller.ts`, `state.ts`, `cluster.ts`, `bootstrap.ts`, `health.ts`, `watcher.ts`, `prune.ts`, `timing.ts`, `template.ts`, `src/processes/`, `src/frontends/` from the src root. Remove `src/commands/up.ts`, `down.ts`, `destroy.ts`, `status.ts`, `watch.ts`, `prune.ts`, `reload.ts`. Remove `EnvironmentEvents`/`EnvironmentPhase` from `src/api/events.ts`.
