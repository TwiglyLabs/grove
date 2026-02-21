---
title: 'Smoke Tier 5: Lifecycle Edge Case Tests'
status: done
description: >-
  Partial up then prune, double up idempotency, up-down-up restart, concurrent
  up on different branches
depends_on:
  - smoke-tier2-mesh
tags:
  - smoke
  - testing
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:56.205Z'
completed_at: '2026-02-21T18:11:27.634Z'
---

## Problem
Grove's environment lifecycle has edge cases that unit tests cannot cover because they depend on real cluster state, real processes, and real timing. These are the scenarios that bite developers during daily use:

1. **Partial up then prune:** `grove up` fails halfway (e.g., Helm deploy fails), leaving a namespace and state file but no running services. `grove prune` should clean this up.
2. **Double up idempotency:** Running `grove up` when the environment is already running should not create duplicate port-forwards, duplicate namespaces, or corrupt state.
3. **Up-down-up restart:** `grove up`, then `grove down` (stops processes but keeps namespace/state), then `grove up` again should reuse the existing namespace and ports.
4. **Concurrent up on different branches:** Two `grove up` calls on different worktree branches should get isolated namespaces and non-overlapping ports.

The existing integration test (`test/integration/full-lifecycle.integration.test.ts`) tests workspace-level parallelism but does not test these environment-level edge cases because it uses mocked/minimal configs.
## Approach
A single test file `test/smoke/tier5-lifecycle.smoke.test.ts` exercising each scenario against a real cluster. Unlike Tiers 1-4 which use the smoke helpers directly, this tier uses Grove's own API functions (`environment.up`, `environment.down`, `environment.destroy`, `environment.prune`) where possible, testing Grove as a consumer would use it.

This tier uses the smoke fixture config (`test/smoke/fixtures/smoke.grove.yaml`) and scaffolded temporary repos (reusing the `scaffoldRepo` pattern from `test/integration/helpers/scaffold.ts`).

**Key difference from earlier tiers:** Tiers 1-4 orchestrate infrastructure manually with helpers. Tier 5 calls through Grove's API layer to test the full orchestration path -- preflight, bootstrap, cluster, build, deploy, port-forward, health check.

## Steps
1. Create `test/smoke/tier5-lifecycle.smoke.test.ts`
2. Write partial-up-then-prune test: induce a failure mid-up, verify prune cleans the mess
3. Write double-up idempotency test: up twice, verify no duplicate resources
4. Write up-down-up restart test: full cycle, verify port/namespace reuse
5. Write concurrent-up test: two branches, verify isolated namespaces and non-overlapping ports
