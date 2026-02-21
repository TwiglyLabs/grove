---
title: State File Integrity
status: not_started
description: >-
  Fix state file corruption vectors — port allocation races, validation gaps,
  stale .tmp promotion, lock contention, swallowed write errors
tags:
  - reliability
  - environment
  - 'epic:reliability-hardening'
type: bugfix
not_started_at: '2026-02-21T20:29:10.368Z'
---

## Problem
The `.grove/*.json` state file system has eight integrity issues that can cause port collisions, silent data loss, and stuck environments.

1. **`allocatePortBlock` unbounded loop** — `state.ts:69` `while (true)` with no upper bound. If stale state files fill enough blocks, allocated ports exceed 65535 and produce invalid port numbers.

2. **`allocatePortBlock` has no lock** — `state.ts:63-103` is exported and callable outside the sentinel lock. Two concurrent callers scanning the same state files get duplicate port blocks. Documented in `state.concurrency.test.ts:72`.

3. **Corrupt state silently falls through to new port allocation** — `loadOrCreateState` line 198 (`console.warn`, fall through). A momentarily-corrupted state file causes Grove to forget existing port assignments and allocate new ones, orphaning old processes.

4. **`loadOrCreateState` double-check accepts `{}` as valid** — Line 219 does `JSON.parse(content) as EnvironmentState` without calling `validateState()`. The sentinel bootstrap writes `'{}'` via `writeFileSync(stateFile, '{}', { flag: 'wx' })` (line 278). If a crash leaves this as the only content, it's returned with undefined ports/processes.

5. **`validateState` accepts arrays for `ports`/`processes`** — `state.ts:130-131` checks `typeof x === 'object' && x !== null` which passes for arrays. `Object.values(state.ports)` on an array produces numeric-index keys, breaking port collision detection.

6. **Stale `.tmp` file promoted by `readState`** — `state.ts:161-177` promotes a surviving `.tmp` to main file. If a previous write cycle crashed between `writeFileSync(tmpFile)` and `renameSync(tmpFile, stateFile)`, the `.tmp` is stale. A second crash scenario causes `readState` to promote this old `.tmp`, silently regressing state.

7. **`releasePortBlock` lockSync fails immediately under contention** — `state.ts:109` uses `LOCK_OPTIONS_SYNC = { stale: 10000 }` with no retries. If the lock is held, `lockSync` throws immediately. The catch at line 115 calls `console.warn` and skips the deletion. Port block is never freed.

8. **`down()` state write failure silently swallowed** — `api.ts:171-175` wraps `writeState` in `try/catch {}`. Next `grove up` reads stale state with dead PIDs.
## Approach
Fix state file operations from the inside out — validation first, then atomicity, then locking.

1. **Tighten `validateState`** — Add `!Array.isArray` checks for `ports` and `processes`.

2. **Add validation to `loadOrCreateState` double-check** — Call `validateState()` on the inner read path and fall through on failure.

3. **Add upper bound to `allocatePortBlock`** — Guard with `if (startPort + blockSize > 65535) throw new PortRangeExhaustedError()`. Add a new error class.

4. **Make `allocatePortBlock` private** — Remove the export. It should only be called within the sentinel lock inside `loadOrCreateState`. If tests need it, test through `loadOrCreateState`.

5. **Fix `.tmp` promotion** — In `readState`, before promoting `.tmp`, compare its `lastEnsure` timestamp against the main file's mtime. Simpler alternative: delete the `.tmp` in `writeState` after `renameSync` succeeds (as a cleanup guard), so no stale `.tmp` survives.

6. **Fix `releasePortBlock` lock contention** — Add retry policy to `LOCK_OPTIONS_SYNC`.

7. **Fix corrupt state fallthrough** — In `loadOrCreateState`, attempt `.tmp` recovery (like `readState` does) before falling through to fresh allocation.

8. **Surface `down()` state write failure** — Replace empty catch with `printError` warning.

## Steps
### Chunk 1: Validation hardening

- [ ] `validateState` — add `!Array.isArray(record.ports) && !Array.isArray(record.processes)`
- [ ] `validateState` — add null guard: `record.ports !== null && record.processes !== null` (already checked via `typeof === 'object'`, but `typeof null === 'object'` passes — the existing `!== null` check only guards the top-level `obj`, not the fields themselves)
- [ ] `loadOrCreateState` double-check (line 216-222) — call `validateState()` on parsed content, fall through to create on failure
- [ ] Tests: validateState rejects `{ ports: [], processes: [] }`
- [ ] Tests: validateState rejects `{ ports: null, processes: {} }`
- [ ] Tests: validateState rejects `{ ports: 'string', processes: {} }`
- [ ] Tests: loadOrCreateState with `'{}'` as file content creates new valid state

### Chunk 2: Port allocation safety

- [ ] Add `PortRangeExhaustedError` to `errors.ts`
- [ ] `allocatePortBlock` — add guard: `if (startPort + blockSize > 65535) throw new PortRangeExhaustedError()`
- [ ] Change `allocatePortBlock` from `export function` to plain `function` (remove export)
- [ ] Update any tests that call `allocatePortBlock` directly to go through `loadOrCreateState`
- [ ] Tests: port exhaustion throws `PortRangeExhaustedError` with actionable message

### Chunk 3: Atomic write safety

- [ ] `writeState` — after `renameSync(tmpFile, stateFile)` succeeds (line 291), add `try { unlinkSync(tmpFile) } catch {}` as cleanup guard
- [ ] `readState` `.tmp` promotion — add staleness check: only promote if `.tmp` mtime is newer than a reasonable threshold (e.g., 60 seconds), otherwise delete the stale `.tmp`
- [ ] Tests: stale `.tmp` from a previous crash is not promoted
- [ ] Tests: fresh `.tmp` from a just-crashed write is recovered correctly

### Chunk 4: Lock and error handling

- [ ] `LOCK_OPTIONS_SYNC` — add retry policy: `{ stale: 10000, retries: { retries: 10, minTimeout: 50, maxTimeout: 200 } }`
- [ ] `releasePortBlock` — on lock failure after retries, log actionable error with `grove prune` hint
- [ ] `loadOrCreateState` corrupt file path — attempt `.tmp` recovery before falling through to fresh allocation
- [ ] `api.ts:down()` — replace empty catch with `printError('Warning: could not save state after stop — run grove prune to clean up')`
- [ ] `getAllUsedPorts` — on JSON parse failure, log a warning with the filename instead of silently skipping (helps diagnose partially-written state files)
- [ ] Tests: releasePortBlock succeeds after contention resolves
- [ ] Tests: down() logs warning when writeState fails
- [ ] Tests: getAllUsedPorts with corrupt JSON file logs warning and continues
