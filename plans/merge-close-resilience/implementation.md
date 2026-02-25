## Steps
### Completed (chunks 1-3 partial)

Chunks 1 and 2 are fully implemented and tested on the `resiliency` branch. Chunk 3 logger injection is wired through `api.ts` and `close.ts` but not yet into `sync.ts` internals.

### Remaining: Thread logger into syncWorkspace

1. **Add `Logger` parameter to `syncWorkspace()`** (`sync.ts:15`)
   - Change signature: `syncWorkspace(branch: string, logger?: Logger)`
   - Import `Logger` from `@twiglylabs/log`

2. **Add logging calls inside `syncWorkspace()`**
   - Log sync start with repo count: after ordering repos (line 49)
   - Log per-repo merge attempt: before `merge()` call (line 91)
   - Log per-repo merge result: after success (line 93) or conflict (line 99)
   - Log conflict-resolved detection: inside the `conflicted` branch (line 60)
   - Log sync completion: before returning (line 121)

3. **Thread logger from callers**
   - `api.ts:sync()` line 144: pass `log` to `internalSync(state.branch, log)`
   - `close.ts:syncAndLog()` line 124: pass `logger` to `syncWorkspace(state.branch, logger)`

4. **Update tests**
   - Add test in `sync.test.ts`: verify logger receives calls during sync (merge start, merge result)
   - Add test: verify logger is optional (existing tests still pass without it)
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
- [ ] `syncWorkspace()` accepts optional `Logger` parameter
- [ ] Merge operations in sync.ts emit debug-level log entries (per-repo merge start/result)
- [ ] `api.ts:sync()` passes its logger through to `internalSync()`
- [ ] `close.ts:syncAndLog()` passes its logger through to `syncWorkspace()`
- [ ] All existing tests pass unchanged
- [ ] New test verifies logger receives sync operation events
- [ ] `npm run build` succeeds
- [ ] Chunk 4 (async git) documented as deferred — no action needed here
