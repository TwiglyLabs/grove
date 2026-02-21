## Steps


## Testing


## Done-when
- All 4 chunks implemented and tested
- `npm test` passes, `npm run build` succeeds
- `validateState` rejects arrays, null, and non-object values for `ports` and `processes`
- `loadOrCreateState` double-check validates parsed content (not just `JSON.parse as`)
- `allocatePortBlock` throws `PortRangeExhaustedError` when ports exceed 65535
- `allocatePortBlock` is not exported (private to module)
- Stale `.tmp` files are not promoted by `readState`
- `releasePortBlock` retries on lock contention
- `down()` logs warning when state write fails
- `getAllUsedPorts` logs warning for corrupt JSON files
- No regressions in existing tests
