
## Steps
### Stopped Process Detection
1. Implement PID liveness check: read stored PIDs from state, verify each with `kill -0` or equivalent.
2. Collect stale PIDs as candidates for pruning.

### Dangling Port Allocation Detection
1. Integrate `proper-lockfile` (or existing locking mechanism) to safely read the port allocation registry.
2. Identify port blocks that are allocated but have no live corresponding process or workspace state.

### Stale State File Detection
1. For each state file, verify the referenced git worktree path still exists on disk.
2. Mark state files whose worktrees are missing as stale.

### Orphaned Worktree Detection
1. Implement `findOrphanedWorktrees(workspaceId)` in `workspace/api.ts`.
2. Enumerate git worktrees; cross-reference with active workspace state to find orphans.

### Compose Unified prune()
1. Update `prune()` in `workspace/api.ts` to run all five categories in order: processes → ports → state files → worktrees → namespaces.
2. Add a `dryRun` boolean parameter; when true, collect candidates but perform no deletions.
3. Update `PruneResult` type to include per-category results with counts and identifiers.

### Tests
1. Write tests with orphaned state fixtures covering all five categories.
2. Write a test that verifies `dryRun: true` returns candidates without modifying any state.
3. Verify `PruneResult` shape matches the updated type.

## Testing
- Each orphan category (processes, ports, state files, worktrees, namespaces) is detected and cleaned correctly.
- `dryRun: true` previews all candidates without executing any cleanup.
- `PruneResult` includes per-category results with counts and identifiers.
- Tests use orphaned state fixtures, not live cluster state.
- `npm run build` succeeds with no type errors.
- `npm test` passes with all tests green.

## Done-when
- `prune()` handles all 5 orphan categories: stopped processes, dangling ports, stale state files, orphaned worktrees, and orphaned namespaces.
- `dryRun` parameter works correctly: no side effects when `true`.
- Structured `PruneResult` is returned with per-category breakdown.
- Tests cover all five categories using fixture data.
