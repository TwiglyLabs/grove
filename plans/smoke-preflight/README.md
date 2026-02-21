---
title: Preflight Checks Module
status: done
description: >-
  Add infrastructure preflight checks (container runtime, CLI tools, port
  availability, cluster reachability) that run before bootstrap in
  ensureEnvironment()
tags:
  - smoke
  - environment
  - reliability
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:51.516Z'
completed_at: '2026-02-21T18:11:04.297Z'
---

## Problem
The existing bootstrap system in `src/environment/bootstrap.ts` only handles config-declared checks (fileExists, dirExists, commandSucceeds) with associated fixes. It does not verify that the underlying infrastructure is functional before attempting environment orchestration.

When `ensureEnvironment()` runs, it immediately tries `ensureCluster()` which calls `k3d cluster list` or `kind get clusters`. If Docker/Colima is not running, or if kubectl is missing, the user gets a cryptic execSync error instead of a clear diagnostic.

Preflight checks are fundamentally different from bootstrap checks:
- **Bootstrap checks** are config-driven, declared in `.grove.yaml`, and have fixes (copy a file, run a command).
- **Preflight checks** are implicit/mandatory infrastructure invariants that must hold before any Grove operation. They have no "fix" -- they fail with a clear message telling the user what to do.

This separation argues for a new module rather than extending the existing bootstrap system.
## Approach
Create a new `src/environment/preflight.ts` module with a `runPreflightChecks(config)` function. This runs **before** bootstrap in the `ensureEnvironment()` flow.

**Design decisions:**
1. **Separate module, not extending bootstrap.ts** -- Bootstrap is config-driven with check/fix pairs. Preflight is implicit with fail-fast behavior. Mixing them would conflate two different concerns.
2. **Returns structured results** -- `PreflightResult[]` array so callers (tests, CLI, API) can inspect individual check outcomes.
3. **Throws on failure** -- Uses a new `PreflightFailedError` (extends `GroveError`) with the full results attached, so `ensureEnvironment()` stops immediately with a clear message.
4. **Checks are ordered** -- Container runtime first (everything else depends on it), then CLI tools, then cluster, then ports.
5. **Port check uses `net.createServer`** -- Bind test is the only reliable way to check port availability. The `listen(0)` pattern is not useful here; we need to test specific ports from the allocated block.

## Steps
1. Add `PreflightFailedError` to `src/shared/errors.ts`
2. Create `src/environment/preflight.ts` with the check functions and `runPreflightChecks()`
3. Create `src/environment/preflight.test.ts` with unit tests (mock execSync, net.createServer)
4. Wire `runPreflightChecks()` into `ensureEnvironment()` in `src/environment/controller.ts` -- call it before `runBootstrapChecks()`
5. Add `PreflightResult` and `PreflightCheck` types to `src/environment/types.ts`
6. Re-export the new error class from `src/lib.ts`
