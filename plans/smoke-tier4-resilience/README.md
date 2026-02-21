---
title: 'Smoke Tier 4: Port-Forward Resilience Tests'
status: done
description: 'Idle timeout, kill and detect, concurrent forwards, pod restart under forward'
depends_on:
  - smoke-tier2-mesh
tags:
  - smoke
  - testing
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:55.763Z'
completed_at: '2026-02-21T18:11:23.037Z'
---

## Problem
Port-forwarding is the most fragile part of Grove's environment orchestration. `kubectl port-forward` is a long-lived process that can die silently due to:

- **Idle timeout:** kubectl may drop the connection after inactivity
- **Pod restart:** When a pod restarts (crash, rolling update), the port-forward process does not reconnect
- **Process death:** The port-forward process itself can be killed or crash
- **Concurrent forwards:** Multiple port-forwards competing for resources

Currently, `PortForwardProcess.ts` spawns the process with a 1-second sleep and returns. There is no monitoring, no reconnection, and no way for callers to detect that a forward has died. The health check hardening (smoke-health-hardening plan) adds port binding verification, but does not address ongoing resilience.

These failures are the most common real-world surprises during development. A developer runs `grove up`, walks away for 30 minutes, comes back, and the port-forward is dead. They get `connection refused` and have to re-run `grove up`.
## Approach
This tier tests the failure modes directly rather than adding production code. The tests verify that Grove's current behavior handles these scenarios (or documents where it does not, creating a baseline for future improvements like auto-reconnect).

**Test structure:**
- Deploy services, establish port-forwards
- Test each failure mode: idle timeout, kill detection, concurrent forwards, pod restart
- Verify that health checks detect dead forwards
- Verify that re-running `startPortForward` can recover

These are observational tests that characterize current behavior. Some may fail, documenting known limitations. Use `it.todo()` for tests that describe desired-but-not-yet-implemented behavior (like auto-reconnect).

## Steps
1. Create `test/smoke/tier4-port-forward.smoke.test.ts`
2. Write idle timeout test (forward a port, wait, verify still alive after 60s)
3. Write kill detection test (kill the port-forward process, verify health check detects it)
4. Write concurrent forwards test (forward all four services simultaneously, verify all healthy)
5. Write pod restart test (delete pod, verify forward dies, re-establish, verify recovery)
6. Write re-establishment test (after forward dies, start a new one on same port, verify works)
