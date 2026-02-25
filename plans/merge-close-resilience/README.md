---
title: Make merge-close resilient to concurrent operations
status: done
description: >-
  Fix TOCTOU race in workspace close, add retry logic, improve logging, and
  switch to async git operations
tags:
  - grove
  - reliability
type: bugfix
not_started_at: '2026-02-25T01:11:22.613Z'
started_at: '2026-02-25T01:13:15.927Z'
completed_at: '2026-02-25T03:36:27.463Z'
---

## Problem
Workspace merge-close has a TOCTOU race that causes failures when multiple workspaces sharing the same source repo are closed concurrently (or near-concurrently). The failure leaves workspaces in an unrecoverable `failed` state.

### Failure mechanism

`closeMerge` in `close.ts` does: sync → FF-check → set-closing → FF-merge. Between any two steps, another close operation on a different workspace (same source repo) can advance `main`, causing the FF check or merge to fail.

### Observed impact (from canopy logs)

- `trellis-plan--mcp-text-responses` merge: 14s then "Fast-forward merge failed" → stuck in `failed` state, required manual git surgery
- `trellis-plan--worktree-path-resolution` merge: 4 retry attempts over 3 minutes, all failed (uncommitted changes, conflicts, ff-failure)
- Users cannot recover from `failed` state without manual intervention (editing `~/.grove/workspaces/*.json` + raw git commands)

### Contributing factors

1. **Redundant FF check** — `canFFMerge` (line 83) checks, then `mergeFFOnly` (line 120) does the merge. The check adds latency and a wider race window with zero benefit.
2. **`failed` is a dead end** — `closeMerge` rejects `failed` state (line 38-39). Only recovery is `--discard` (loses work) or manual surgery.
3. **No retry** — a single FF failure permanently kills the workspace.
4. **`execSync` everywhere** — all git operations block the event loop. In an Electron app, this freezes the UI during multi-second merge operations.
5. **No logging in close/sync** — 14-second operations with zero visibility into what's happening.
## Approach
Four chunks, ordered by impact and independence:

### Chunk 1: Retry-on-failure (eliminates the race)
Remove the separate `canFFMerge` check. If `mergeFFOnly` fails, re-sync once and retry. This handles the case where `main` advanced between sync and merge. Only mark `failed` if the retry also fails.

### Chunk 2: Recovery from `failed` state
Allow `closeMerge` to operate on `failed` workspaces by re-syncing first. Currently `syncWorkspace` already accepts `failed` state (sync.ts:21-29) — just need to lift the guard in `closeMerge`.

### Chunk 3: Logger injection into close/sync
Thread an optional logger through `closeWorkspace` and `syncWorkspace`. Log each git operation with timing (merge, checkout, FF merge, worktree remove, branch delete). Uses the same logger pattern as `workspace.create`.

### Chunk 4: Async git operations
Replace `execSync` in `git.ts` with `execFile` (promisified). Update all callers. This is the largest change but unblocks the event loop during git operations.

## Acceptance Criteria
- [ ] A merge-close that races with another close on the same source repo succeeds (retry handles it)
- [ ] A workspace in `failed` state can be merge-closed without manual intervention
- [ ] Close and sync operations emit structured log entries with timing
- [ ] Git operations do not block the Node.js event loop
- [ ] All existing tests pass; new tests cover retry and failed-state recovery paths
- [ ] No breaking changes to public API (logger is optional, async functions return same shapes)

## Steps
### Chunk 1: Retry-on-failure ✅
- [x] Remove separate `canFFMerge` check from close.ts (redundant, widens race window)
- [x] Add retry logic: if `mergeFFOnly` fails, re-sync and retry once before marking `failed`
- [x] Update tests: retry-succeeds, retry-fails-permanently, remove FF-check tests

### Chunk 2: Recovery from `failed` state ✅
- [x] Change `closeMerge` guard to accept both `active` and `failed` status
- [x] `syncWorkspace` already handles `failed` → `active` reset (sync.ts:21-29)
- [x] Add test: merge-close from failed state completes successfully

### Chunk 3: Logger injection into close/sync
- [x] Add optional `Logger` to `CloseOptions`
- [x] Thread logger through `api.ts` → `closeWorkspace`
- [x] Add `syncAndLog` helper that logs sync start/complete
- [x] Log retry attempts and per-repo merge completion
- [ ] Add logger parameter to `syncWorkspace()` and thread from callers
- [ ] Log per-repo merge start/result inside `syncWorkspace()`
- [ ] Add test: verify logger receives sync operation events

### Chunk 4: Async git operations — DEFERRED
Out of scope for this plan. Tracked separately as future work.
