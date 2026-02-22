
## From plans
- **setup-automation** — setup config shape in `.grove.yaml` (hooks config, post-create steps), automatic setup execution after `workspace.create()` so there is a fully-initialised environment to describe

## From existing code
- `src/workspace/` — workspace state (service list, namespace, port mappings)
- `src/environment/` — environment state (running services, health status)
- `src/shared/config.ts` — config loading utilities for reading `.grove.yaml`
