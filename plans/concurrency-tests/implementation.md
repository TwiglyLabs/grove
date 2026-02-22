
## Steps
### Chunk 1 — Core Concurrency Tests (no dependencies)
1. Write test: parallel `workspace.create()` calls allocate unique, non-overlapping port blocks.
2. Write test: parallel `workspace.create()` calls generate unique Kubernetes namespace names.
3. Write test: concurrent writes to the state file do not corrupt state (locking verification).
4. Write test: parallel repo auto-registration does not produce duplicate entries in the registry.
5. Run tests; fix any races discovered in port allocation or state management.

### Chunk 2 — Lifecycle Concurrency Tests (after dependencies land)
1. Write test: a setup command failure in one workspace does not affect other concurrently provisioning workspaces.
2. Write test: `prune()` called while `workspace.up()` is running completes safely without corrupting the up operation.
3. Run tests; fix any races discovered.

### Fix Discovered Races
1. For each race identified in Chunk 1 or Chunk 2, trace the root cause in the relevant `api.ts`.
2. Apply the minimal fix (add locking, fix allocation logic, etc.).
3. Re-run the full test suite to confirm no regressions.

## Testing
- All concurrency tests pass consistently across multiple runs.
- No race conditions detected in port allocation logic.
- No race conditions detected in state file management.
- No race conditions detected in the repo registry.
- Setup failure isolation test demonstrates one workspace failure does not bleed into another.
- Prune-during-up test demonstrates safe concurrent operation.

## Done-when
- Test for port allocation races passes.
- Test for namespace uniqueness passes.
- Test for state file locking under concurrent writes passes.
- Test for registry contention under parallel registration passes.
- Test for setup failure isolation passes.
- Test for prune-during-up safety passes.
- All discovered races are fixed and verified.
