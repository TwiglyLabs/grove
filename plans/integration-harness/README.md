---
title: Integration Test Harness
status: not_started
description: >-
  End-to-end test that creates parallel workspaces, runs setup, verifies
  isolation, destroys, and checks clean state
depends_on:
  - environment-descriptor
  - enhanced-pruning
  - setup-automation
tags:
  - testing
  - reliability
not_started_at: '2026-02-21T02:02:31.859Z'
---

## Problem
Unit tests with mocked infrastructure give confidence in logic but not in real-world behavior. With parallel k8s environments, port forwarding, helm deployments, and worktree management all interacting, we need an end-to-end test that exercises the full stack to catch integration issues.

**This is a capstone plan.** It exercises features from setup-automation (provisioning), environment-descriptor (verification), and enhanced-pruning (cleanup). It should be the last plan executed.
## Approach
A dedicated integration test (run on-demand, not in CI by default) that exercises the full parallel provisioning flow against a real cluster:

1. Create 2-3 workspaces in parallel
2. Run setup on each
3. Call `describe()` on each, verify no port/namespace overlap
4. Verify services are reachable at their URLs
5. Destroy all environments
6. Run prune, verify clean state

This requires a real cluster (kind or k3s) and a test `.grove.yaml`. Keep it as a separate test script, not part of the regular `npm test` suite.

## Steps
1. Create a test fixture project with minimal `.grove.yaml` (simple service with a health endpoint, no heavy builds, setup commands for `npm install` only)
2. Write integration test script that runs the full parallel lifecycle:
   a. Create 2-3 workspaces in parallel via `workspace.create()`
   b. Run `up()` on each
   c. Call `describe()` on each — verify no port/namespace overlap
   d. Verify services are reachable at their URLs (HTTP health check)
   e. Destroy all environments
   f. Run `prune()`, verify clean state (no orphans in any category)
3. Assert: unique namespaces, non-overlapping ports, all descriptors valid
4. Assert: clean state after destroy + prune — zero orphaned worktrees, state files, namespaces
5. Add `npm run test:integration` script (separate from `npm test`, requires real cluster)
6. Document machine requirements (docker, kind/k3s, available port range)
