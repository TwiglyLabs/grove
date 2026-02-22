
## Public API
`src/environment/api.ts` exports:
- `prune(options?: PruneOptions): Promise<PruneResult>` — removes orphaned resources across all 5 categories; supports `dryRun` mode

`src/workspace/api.ts` exports:
- `findOrphanedWorktrees(workspaceId: WorkspaceId): Promise<string[]>` — returns paths of git worktrees with no corresponding active workspace entry

## Types
`src/environment/types.ts` exports:
- `PruneOptions` — `{ dryRun?: boolean }` controls whether changes are applied
- `PruneResult` — per-category results: `{ namespaces, worktrees, stateFiles, ports, processes }` each with `removed: string[]` and `errors: Error[]`
- `PruneCategoryResult` — `{ removed: string[], errors: Error[] }` shape used per category

## Orphan categories handled
The extended `prune()` function detects and removes:
1. Orphaned Kubernetes namespaces (no active workspace entry)
2. Orphaned git worktrees (workspace deleted but worktree remains)
3. Orphaned state files (workspace no longer exists)
4. Orphaned port reservations (process holding port is gone)
5. Orphaned processes (supervisor or port-forward with no live workspace)

## Pattern established
Per-category result collection pattern: each prune category returns its own `PruneCategoryResult` so callers (concurrency-tests, integration-harness) can assert on specific categories independently. `dryRun` flag enables safe inspection without side effects, used by integration tests to validate detection logic.
