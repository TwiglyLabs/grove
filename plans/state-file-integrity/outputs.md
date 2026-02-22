
## Public API changes
`src/environment/api.ts` / state internals:
- `down()` now surfaces write errors: previously swallowed state write failures are thrown so callers see them
- `allocatePortBlock()` made private: no longer callable from outside the state module; external callers use the public API

`src/environment/state.ts` exports:
- `validateState(raw: unknown): EnvironmentState` — tightened: now rejects arrays at the top level, rejects null values in required fields; throws `StateCorruptedError` with descriptive message
- `loadOrCreateState(path: string): Promise<EnvironmentState>` — now performs a double-check after creation to validate the written state is re-readable
- `PortRangeExhaustedError extends GroveError` — thrown when no ports remain in the configured range

## Types
`src/environment/types.ts` exports (additions):
- `PortRangeExhaustedError extends GroveError` — thrown by port allocation when the full configured range is occupied
- `StateCorruptedError extends GroveError` — thrown by `validateState()` when the file content fails schema validation

## Invariants enforced
After this plan, the state file layer enforces:
- No arrays at state root (rejects malformed files that were accidentally written as JSON arrays)
- No null required fields (catches partial writes)
- `.tmp` promotion staleness guard: if the `.tmp` file is older than a threshold, it is discarded rather than promoted
- Lock retry policy: lock acquisition retries with exponential backoff before throwing `LockTimeoutError`
- Port range exhaustion is a named error, not a silent allocation failure

## Pattern established
Hardened state access for downstream: downstream plan (controller-robustness) relies on state reads and writes being atomic and validated. The tightened `validateState`, `.tmp` staleness guard, and surfaced `down()` write errors give controller-robustness a trustworthy state layer to build rollback logic on top of.
