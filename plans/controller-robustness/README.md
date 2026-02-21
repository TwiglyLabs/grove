---
title: Controller Robustness
status: done
description: >-
  Fix ensureEnvironment — incremental state writes, partial failure rollback,
  destroy error handling
depends_on:
  - process-lifecycle-safety
  - state-file-integrity
tags:
  - reliability
  - environment
  - 'epic:reliability-hardening'
type: bugfix
not_started_at: '2026-02-21T20:29:10.766Z'
started_at: '2026-02-21T22:44:32.756Z'
completed_at: '2026-02-21T22:51:24.010Z'
---

## Problem
The `ensureEnvironment` flow in `controller.ts` has three reliability gaps that cause orphaned processes and unhelpful error handling.

1. **State not written until end** — `controller.ts:207` calls `writeState` only after all processes are started, health checks complete, and the supervisor is registered. Any failure between `startPortForwards` (line 184) and `writeState` (line 207) — build error, deploy timeout, health check failure, signal — leaves running processes with no persisted PIDs. `grove down` reads the old state, finds nothing, and reports success.

2. **Partial `startPortForwards` failure orphans processes** — `controller.ts:38-59` loops over services, starting port-forwards one at a time. If service A starts but service B fails, A's process is running and recorded in `state.processes` in-memory. The exception propagates up through `ensureEnvironment`, which never calls `down()` or kills already-started processes. Combined with issue #1, A's PID was never persisted.

3. **`destroy()` namespace error swallowed** — `api.ts:211-212` catches all errors from `kubectl delete namespace` with an empty catch block. If the namespace is stuck in Terminating (a real failure), the user gets `namespaceDeleted: false` with no explanation. A subsequent `grove up` creates resources in a terminating namespace, causing confusing kubectl errors.
## Approach
**Incremental state writes** — Write state at each milestone within `ensureEnvironment`, not just at the end. This closes the window where processes exist but state doesn't reflect them.

**Rollback on partial failure** — Wrap `startPortForwards` and `startFrontends` in try/catch. On failure, iterate `state.processes` and kill any already-started processes before re-throwing. Write the cleaned state before re-throwing so a subsequent `down()` finds clean state.

**Structured namespace error** — In `destroy()`, catch namespace deletion errors, inspect for `not found` (expected/silent) vs timeout/other (log the error, still return `namespaceDeleted: false`).

These changes depend on:
- **process-lifecycle-safety** — `killProcess` must work correctly and FD leaks must be fixed before rollback kills processes
- **state-file-integrity** — `writeState` must be reliable before we call it more frequently

## Steps
### Chunk 1: Incremental state writes

- [ ] After `startPortForwards` completes (controller.ts:184), call `await writeState(state, config)` — persists port-forward PIDs immediately
- [ ] After `startFrontends` completes (controller.ts:185), call `await writeState(state, config)` — persists frontend PIDs
- [ ] Keep the final `writeState` at line 207 (it updates `lastEnsure` and captures supervisor registration)
- [ ] Tests: mock writeState to verify it's called after startPortForwards and after startFrontends

### Chunk 2: Partial failure rollback

- [ ] Extract a helper: `async function killStartedProcesses(state: EnvironmentState)` that iterates `state.processes` and calls `killProcess` on each
- [ ] Wrap `startPortForwards(config, state)` in try/catch inside `ensureEnvironment` — on failure, call `killStartedProcesses(state)`, write cleaned state, re-throw
- [ ] Wrap `startFrontends(config, state, options)` similarly — kill all processes (port-forwards + any started frontends), write state, re-throw
- [ ] Tests: service A starts, service B fails → A is killed, state.processes is empty, error propagates
- [ ] Tests: port-forwards succeed, frontend fails → all port-forwards killed, state cleaned

### Chunk 3: Destroy error handling + cluster/namespace error surfacing

- [ ] In `api.ts:destroy()`, replace the empty catch with error inspection
- [ ] If error message/stderr contains 'not found' or 'NotFound' → expected, `namespaceDeleted: false` silently
- [ ] For any other error → `printError` with the failure reason, still set `namespaceDeleted: false`
- [ ] Optionally wrap in `NamespaceDeletionFailedError` (already exists in errors.ts) and attach to `DestroyResult`
- [ ] `ensureCluster` (controller.ts:164) — verify it throws on failure or wrap in try/catch with a clear error message if the cluster cannot be created/reached
- [ ] `ensureNamespace` (controller.ts:175) — same: verify it surfaces errors or add try/catch with `printError` on failure
- [ ] Tests: destroy with non-existent namespace succeeds silently
- [ ] Tests: destroy with timeout error logs warning
- [ ] Tests: ensureCluster failure propagates with clear message
