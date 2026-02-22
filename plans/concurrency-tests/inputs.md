
## From plans
- **enhanced-pruning** — `prune()` function for testing prune-during-up races and concurrent prune behaviour
- **setup-automation** — setup command infrastructure for testing setup failure isolation and interleaved setup/teardown

## From existing code
- `src/workspace/api.ts` — `workspace.create()` and related workspace lifecycle functions
- `src/environment/api.ts` — port allocation, environment state management
- State file management utilities (lock acquisition, read/write helpers)
