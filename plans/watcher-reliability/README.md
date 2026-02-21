---
title: Watcher Reliability
status: not_started
description: >-
  Fix file watcher — dropped async errors, infinite rebuild loops, silent
  failures, debounce cleanup
tags:
  - reliability
  - environment
  - 'epic:reliability-hardening'
type: bugfix
not_started_at: '2026-02-21T20:29:11.252Z'
---

## Problem
The `FileWatcher` in `watcher.ts` has five reliability issues that can crash the watcher, cause infinite loops, or silently drop errors.

1. **Dropped rebuild promise crashes Node** — `scheduleRebuild` (line 105-108) fires `this.rebuild(service)` inside `setTimeout` without `await`. The returned promise is dropped. In Node 18+, unhandled rejections crash the process by default. If the retry loop inside `rebuild` throws (e.g., a `BuildFailedError` on final attempt), the `onError` event is never reached because the rejection escapes before the catch block.

2. **Infinite rebuild loop** — If build steps write files into watched paths (generated manifests, compiled output in `src/`), chokidar fires another `change` event, triggering another rebuild. No guard prevents this.

3. **`handleReloadRequest` silently drops all errors** — `watcher.ts:182-184` catches everything with `// File might have been deleted already`. Non-ENOENT errors (permissions, I/O) are swallowed. The user's `grove reload api` appears to succeed but the rebuild never happens.

4. **`watch().reload()` errors are unhandled** — `api.ts:331-333` calls `orchestrator.buildService()`, `loadImage()`, `helmUpgrade()` synchronously with no try/catch. Any thrown error propagates as an unhandled exception — no event emission, no `printError`.

5. **In-flight rebuild survives `stop()`** — `stop()` (line 187-199) cancels pending debounce timers but does not abort in-flight `rebuild` promises. A long docker build or helm upgrade continues after the watcher is told to stop.
## Approach
Fix the watcher from the inside out:

**Soft dependency:** The `GroveError` prototype chain fix from `error-infra-and-api-surface` should be implemented first. The `scheduleRebuild` catch handler relies on `error instanceof GroveError` working correctly to route errors. Without the prototype fix, every `GroveError` subclass fails the `instanceof` check and gets double-wrapped in `BuildFailedError`. Implement error-infra first, or at minimum the prototype chain fix (chunk 1 of that plan).

1. **Catch dropped promise** — Add `.catch()` handler to the `this.rebuild(service)` call inside `scheduleRebuild`. Route errors through `this.events?.onError?.()`.

2. **Rebuild guard** — Track a per-service `rebuilding` flag. While a rebuild for service S is in-flight, discard further change events for S (or queue exactly one). Clear the flag in both success and final-failure paths.

3. **Narrow `handleReloadRequest` catch** — Only catch ENOENT. Re-emit any other error through `this.events?.onError?.()`.

4. **Fix `watch().reload()`** — Wrap the three orchestrator calls in try/catch, emit `onError` via the events closure.

5. **Stopped flag** — Set a `stopped` boolean in `stop()`. Check it at the start of each `rebuild` iteration and inside `verifyServiceHealth`. Return early if stopped.
## Steps
### Chunk 1: Async error safety

- [ ] `scheduleRebuild` — change `this.rebuild(service)` to `this.rebuild(service).catch(err => this.events?.onError?.(err instanceof GroveError ? err : new BuildFailedError(service.name, err)))`
- [ ] `api.ts:watch().reload()` — wrap orchestrator calls in try/catch, emit `onError`
- [ ] Tests: rebuild throws on final attempt → onError event fired (not unhandled rejection)
- [ ] Tests: watch().reload() with build failure → onError event fired

### Chunk 2: Rebuild loop prevention

- [ ] Add `private rebuilding: Set<string> = new Set()` to `FileWatcher`
- [ ] At start of `rebuild()`, add service name to `rebuilding` set. Remove in finally block.
- [ ] In `scheduleRebuild`, if `this.rebuilding.has(key)`, skip (or set a `pendingRebuild` flag to re-trigger once current completes)
- [ ] Tests: file change during in-flight rebuild is coalesced, not duplicated
- [ ] Tests: file change after rebuild completes triggers a new rebuild

### Chunk 3: Error narrowing and stop safety

- [ ] `handleReloadRequest` — narrow catch to check `(error as NodeJS.ErrnoException).code === 'ENOENT'`. Re-throw or emit others.
- [ ] Add `private stopped = false` field. Set `this.stopped = true` in `stop()`.
- [ ] At top of `rebuild` loop body: `if (this.stopped) return;`
- [ ] At top of `verifyServiceHealth`: `if (this.stopped) return;`
- [ ] Tests: handleReloadRequest with ENOENT is silent, with EACCES fires onError
- [ ] Tests: stop() during in-flight rebuild → rebuild returns early on next iteration

### Chunk 4: Watcher start() test coverage + watchPaths validation

- [ ] Test: file change in service A path triggers rebuild for A only
- [ ] Test: file change matching no service is ignored
- [ ] Test: `.reload-request` creation triggers handleReloadRequest
- [ ] Test: stop() clears pending debounce timers
- [ ] In `start()`, validate that configured `watchPaths` resolve to existing directories — `printError` for paths that don't exist (non-fatal, but helps users catch config typos)
