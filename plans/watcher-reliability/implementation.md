## Steps


## Testing


## Done-when
- All 4 chunks implemented and tested
- `npm test` passes, `npm run build` succeeds
- `scheduleRebuild` catches dropped promise and routes through `onError`
- `watch().reload()` catches orchestrator errors and routes through `onError`
- Concurrent file changes for the same service are coalesced (no infinite rebuild loop)
- `handleReloadRequest` only catches ENOENT, re-emits other errors
- `stop()` sets `stopped` flag; in-flight rebuilds exit early
- Non-existent `watchPaths` produce a warning at watcher start
- No regressions in existing tests
