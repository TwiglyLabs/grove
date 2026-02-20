---
title: 'Environment Slice: K8s Orchestration'
status: draft
depends_on:
  - foundation
description: >-
  Migrate K8s environment orchestration (up/down/destroy, state, processes,
  health, cluster, bootstrap, watcher) into vertical slice
tags:
  - slice
---

## Problem

The K8s environment orchestration is the original core of grove and the most sprawling part of the codebase. It's scattered across the `src/` root: `controller.ts` (the ensure/up flow), `state.ts` (port allocation, environment state, locking), `cluster.ts`, `bootstrap.ts`, `health.ts`, `watcher.ts`, `prune.ts`, `timing.ts`, plus `src/processes/` and `src/frontends/`. These files have tight coupling through shared types and state, but no explicit boundary.

## Approach

**Consolidate into `src/environment/`.** This is the largest slice, with internal structure:

- `src/environment/types.ts` — `EnvironmentState`, `ProcessInfo`, `UpOptions`, `UpResult`, `DownResult`, `DestroyResult`, `DashboardData`, `WatchHandle`, `PruneResult`
- `src/environment/state.ts` — port allocation, state file I/O, locking (from current `state.ts`)
- `src/environment/controller.ts` — the `ensureEnvironment()` orchestration flow
- `src/environment/cluster.ts` — kind cluster management
- `src/environment/bootstrap.ts` — pre-flight bootstrap checks and fixes
- `src/environment/health.ts` — health check polling
- `src/environment/watcher.ts` — chokidar file watching and rebuild triggering
- `src/environment/prune.ts` — orphaned resource cleanup
- `src/environment/processes/` — `BuildOrchestrator`, `PortForwardProcess`
- `src/environment/frontends/` — `GenericDevServer`
- `src/environment/config.ts` — owns the config schema sections: project, helm, services, frontends, bootstrap
- `src/environment/api.ts` — public API: `up()`, `down()`, `destroy()`, `status()`, `watch()`, `prune()`
- `src/environment/cli.ts` — commander subcommands: `up`, `down`, `destroy`, `status`, `watch`, `prune`
- `src/environment/*.test.ts` — colocated tests

**Config ownership.** The environment slice owns the largest chunk of `.grove.yaml` schema: project, helm, services, frontends, bootstrap. These zod schemas move from the root `config.ts` into `src/environment/config.ts` and are composed back into the root config.

**Delete old root files.** Remove `controller.ts`, `state.ts`, `cluster.ts`, `bootstrap.ts`, `health.ts`, `watcher.ts`, `prune.ts`, `timing.ts`, `src/processes/`, `src/frontends/` from the src root. Remove `src/commands/up.ts`, `down.ts`, `destroy.ts`, `status.ts`, `watch.ts`, `prune.ts`.
