## Steps


## Testing


## Done-when
- All 3 chunks implemented and tested
- `npm test` passes, `npm run build` succeeds
- `writeState` called after `startPortForwards` and after `startFrontends` (not just at end)
- Partial `startPortForwards` failure kills already-started processes and cleans state
- Partial `startFrontends` failure kills all started processes and cleans state
- `destroy()` logs meaningful error when namespace deletion fails (not empty catch)
- `destroy()` distinguishes "not found" (silent) from other errors (logged)
- `ensureCluster`/`ensureNamespace` failures surface with clear messages
- No regressions in existing tests
