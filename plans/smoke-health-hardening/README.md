---
title: Health Check Hardening
status: done
description: >-
  Make health check failures propagate, return structured results, add health
  status to UpResult, verify port-forward binding
depends_on:
  - smoke-preflight
tags:
  - smoke
  - environment
  - reliability
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:52.561Z'
completed_at: '2026-02-21T18:11:07.204Z'
---

## Problem
The current health check system has four interrelated problems:

1. **Silent failures in `healthCheckAll()`** (controller.ts:96-142): When `waitForHealth()` returns false, the controller calls `printError()` but does not throw or return failure status. `ensureEnvironment()` proceeds to "Environment ready" even when services are unhealthy.

2. **`UpResult` lacks health status** (types.ts:56-61): The return type has `{state, urls, ports, duration}` but no health information. Callers (CLI, API consumers, tests) cannot programmatically determine if the environment is actually healthy.

3. **Port-forward fire-and-forget** (PortForwardProcess.ts:50): After spawning `kubectl port-forward`, the process sleeps 1000ms and returns. There is no verification that the port actually bound. If kubectl fails to connect (wrong namespace, service not ready), the caller gets a PID back but the forward is dead.

4. **No application-level readiness** (health.ts): `checkHttpHealth()` considers any 200-499 status code healthy. This is fine for "port is open" but insufficient for "service is ready to handle requests" (e.g., database migrations pending, warmup incomplete). There is no way to specify a custom readiness endpoint that must return 200.
## Approach
**Backward compatibility strategy**: All changes are additive. Existing behavior (print and continue) remains the default. A new `strict` option triggers the fail-on-unhealthy behavior.

1. **`HealthCheckResult` type** -- Structured result replacing the bare boolean. Contains `{target, healthy, protocol, port, attempts, elapsed, error?}`.

2. **`healthCheckAll()` returns `HealthCheckResult[]`** -- Instead of void, returns the full array. Controller can inspect results and decide whether to throw.

3. **`UpResult.health` field** -- Add `health: HealthCheckResult[]` to `UpResult`. Callers inspect `result.health.every(h => h.healthy)` to determine overall status.

4. **Port-forward verification** -- After the 1000ms sleep, do a TCP health check on the local port. If it fails, retry the wait with backoff up to 5s. If still dead, throw `PortForwardFailedError`.

5. **Readiness endpoint support** -- Extend `HealthCheckSchema` with optional `readinessPath` field. When present, `waitForHealth()` checks the readiness path (must return 200) after the basic health check passes. This is a separate concern from "port is open".

6. **Strict mode** -- `UpOptions` gets `strict?: boolean`. When true, `ensureEnvironment()` throws `HealthCheckFailedError` if any health check fails. Default is false (existing behavior preserved).

## Steps
1. Add `HealthCheckResult` type to `src/environment/types.ts`
2. Add `PortForwardFailedError` to `src/shared/errors.ts`
3. Add `readinessPath` to `HealthCheckSchema` in `src/environment/config.ts`
4. Modify `waitForHealth()` in `src/environment/health.ts` to return `HealthCheckResult` instead of boolean
5. Add `verifyPortForward()` to `src/environment/processes/PortForwardProcess.ts`
6. Modify `healthCheckAll()` in `src/environment/controller.ts` to return `HealthCheckResult[]`
7. Add `strict` option to `UpOptions` and wire through `ensureEnvironment()`
8. Add `health` field to `UpResult` in `src/environment/types.ts`
9. Update `src/environment/api.ts` to pass strict option and include health in result
10. Write tests for all modified functions
11. Re-export new types from `src/lib.ts`
