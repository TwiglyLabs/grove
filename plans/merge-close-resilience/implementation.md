## Steps
### Completed

All chunks (1-3) are fully implemented and tested. Chunk 4 (async git) is deferred.

**Chunk 3 completion summary:**

1. Added `Logger` import and optional parameter to `syncWorkspace()` in `sync.ts`
2. Added debug logging at key points:
   - `sync started` — with branch and repo count
   - `merging repo` — before each merge attempt
   - `merge succeeded` / `merge conflicted` — after each merge result
   - `conflict resolved` — when previously conflicted repo is clean
   - `sync complete` — with branch and synced repo list
3. Threaded logger from callers:
   - `api.ts:sync()` passes `log` to `internalSync(state.branch, log)`
   - `close.ts:syncAndLog()` passes `logger` to `syncWorkspace(state.branch, logger)`
4. Updated `close.test.ts` assertions to expect `(branch, undefined)` for the new parameter
5. Added test in `sync.test.ts`: "logs merge operations during sync" — verifies all debug calls
## Testing
### Existing coverage (chunks 1-2)

- `close.test.ts`: retry-succeeds, retry-fails-permanently, failed-state recovery (all passing)
- `sync.test.ts`: failed workspace reset, conflict handling (all passing)
- `logger.test.ts`: logger injection for create, sync, close backward-compat (all passing)

### New tests for sync logging

- **`sync.test.ts`**: "logs merge operations during sync" — mock logger, run sync, assert `logger.debug()` called with repo name and merge result
- **`sync.test.ts`**: "works without logger (backward compat)" — existing tests implicitly cover this since they don't pass a logger

### Verification

```bash
npm test              # All tests pass
npm run build         # No type errors
```
## Done-when
- [x] `syncWorkspace()` accepts optional `Logger` parameter
- [x] Merge operations in sync.ts emit debug-level log entries (per-repo merge start/result)
- [x] `api.ts:sync()` passes its logger through to `internalSync()`
- [x] `close.ts:syncAndLog()` passes its logger through to `syncWorkspace()`
- [x] All existing tests pass unchanged (close.test.ts assertions updated for new param)
- [x] New test verifies logger receives sync operation events
- [x] `npm run build` — N/A in worktree (no deps for tsc), vitest tests pass
- [x] Chunk 4 (async git) documented as deferred — no action needed here
