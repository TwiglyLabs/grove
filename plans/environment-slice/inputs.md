## From plans

- **foundation** — directory layout (`src/environment/` exists), shared errors, shared output helpers, commander CLI skeleton, config compositor pattern

## From existing code

- `src/controller.ts` — `ensureEnvironment()` orchestration
- `src/state.ts` — `EnvironmentState`, port allocation, state file I/O, locking
- `src/cluster.ts` — kind cluster management
- `src/bootstrap.ts` — bootstrap checks and fixes
- `src/health.ts` — health check polling
- `src/watcher.ts` — file watching
- `src/prune.ts` — orphaned resource cleanup
- `src/timing.ts` — timer utility
- `src/processes/BuildOrchestrator.ts` — docker build and helm deploy
- `src/processes/PortForwardProcess.ts` — kubectl port-forward management
- `src/frontends/GenericDevServer.ts` — frontend dev server management
- `src/config.ts` — project, helm, services, frontends, bootstrap zod schemas
- `src/commands/up.ts`, `down.ts`, `destroy.ts`, `status.ts`, `watch.ts`, `prune.ts` — CLI commands
- `src/api/environment.ts` — current public API wrapper
- `src/api/types.ts` — environment type definitions
