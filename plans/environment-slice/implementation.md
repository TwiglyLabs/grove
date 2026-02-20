## Steps
### Consolidate types

1. Create `src/environment/types.ts` — move `EnvironmentState`, `ProcessInfo` from `src/state.ts`. Add public types from `src/api/types.ts` (UpOptions, UpResult, DownResult, DestroyResult, DashboardData, WatchHandle, PruneResult). Add `EnvironmentEvents`, `EnvironmentPhase` from `src/api/events.ts`
2. Run tests

### Move core modules

3. Move `src/state.ts` → `src/environment/state.ts` (port allocation, state file I/O, locking). Update imports to use local `types.ts`
4. Move `src/state.test.ts` → `src/environment/state.test.ts`
5. Move `src/controller.ts` → `src/environment/controller.ts`
6. Move `src/cluster.ts` → `src/environment/cluster.ts`
7. Move `src/bootstrap.ts` → `src/environment/bootstrap.ts`
8. Move `src/health.ts` → `src/environment/health.ts`
9. Move `src/watcher.ts` → `src/environment/watcher.ts`
10. Move `src/prune.ts` → `src/environment/prune.ts`
11. Move `src/timing.ts` → `src/environment/timing.ts`
12. Move `src/template.ts` → `src/environment/template.ts`
13. Move `src/template.test.ts` → `src/environment/template.test.ts`
14. Move `src/processes/` → `src/environment/processes/`
15. Move `src/frontends/` → `src/environment/frontends/`
16. Update all imports across the codebase
17. Run tests

### Config ownership

18. Create `src/environment/config.ts` — move project, helm, services, frontends, bootstrap zod schemas from root `config.ts`. Also take `reloadTargets` from `UtilitiesSchema`
19. Update root `src/config.ts` to import environment schemas from slice and compose
20. Run tests

### Consolidate API

21. Create `src/environment/api.ts` with public API: `up()`, `down()`, `destroy()`, `status()`, `watch()`, `reload()`, `prune()`. Pull logic from `src/api/environment.ts` and `src/commands/reload.ts`
22. Move/merge API tests into colocated tests
23. Run tests

### Create CLI subcommands

24. Create `src/environment/cli.ts` — commander commands for `grove up`, `grove down`, `grove destroy`, `grove status`, `grove watch`, `grove reload`, `grove prune`. Move arg parsing and output from `src/commands/{up,down,destroy,status,watch,prune,reload}.ts`
25. Register all in `src/cli.ts`
26. Move command tests into colocated tests
27. Run tests

### Wire and cleanup

28. Update `src/index.ts` to re-export `import * as environment from './environment/api.js'`
29. Remove old root files: `controller.ts`, `state.ts`, `cluster.ts`, `bootstrap.ts`, `health.ts`, `watcher.ts`, `prune.ts`, `timing.ts`, `template.ts`
30. Remove `src/processes/`, `src/frontends/`
31. Remove `src/commands/{up,down,destroy,status,watch,prune,reload}.ts` and their test files
32. Remove `src/api/environment.ts`, environment types from `src/api/types.ts`, `EnvironmentEvents`/`EnvironmentPhase` from `src/api/events.ts`
33. Run full test suite — all must pass
34. Build and verify no type errors

## Testing
- All existing environment tests pass — state, template, command tests now colocated in `src/environment/`
- `grove up`, `grove down`, `grove destroy`, `grove status`, `grove watch`, `grove reload`, `grove prune` all work via commander
- Template resolution tests pass in new location
- Library consumers can `import { environment } from 'grove'` and call environment API
- `readState(config)` is accessible from satellite slices (testing, shell, logs, simulator)
- Config compositor correctly composes environment schemas back into root
- Build succeeds with no type errors

## Done-when
- `src/environment/` contains types.ts, state.ts, controller.ts, cluster.ts, bootstrap.ts, health.ts, watcher.ts, prune.ts, timing.ts, template.ts, config.ts, api.ts, cli.ts, processes/, frontends/, and colocated tests
- All old root files deleted: controller.ts, state.ts, cluster.ts, bootstrap.ts, health.ts, watcher.ts, prune.ts, timing.ts, template.ts, processes/, frontends/
- All old commands deleted: up.ts, down.ts, destroy.ts, status.ts, watch.ts, prune.ts, reload.ts
- `src/api/environment.ts` deleted, environment types removed from `src/api/types.ts`, EnvironmentEvents/EnvironmentPhase removed from `src/api/events.ts`
- Root config imports environment schemas from slice
- All tests pass, build succeeds
