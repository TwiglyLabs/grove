---
title: 'Smoke Tier 1: Infrastructure Tests'
status: done
description: >-
  Container runtime, cluster create/delete, helm install/uninstall, image
  build+load, port-forward establishment, namespace isolation
depends_on:
  - smoke-test-infra
  - smoke-stub-services
  - smoke-health-hardening
tags:
  - smoke
  - testing
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:54.259Z'
completed_at: '2026-02-21T18:11:12.996Z'
---

## Problem
Before testing service mesh behavior or frontend integration, the smoke test suite needs to verify that the foundational infrastructure works: Docker builds succeed, images load into k3d, Helm charts deploy, port-forwards bind, and namespaces provide isolation.

These are the assumptions that every subsequent tier depends on. If a Docker build fails or a port-forward never binds, Tier 2+ tests will fail with confusing errors. Tier 1 catches these problems early with clear diagnostics.
## Approach
A single test file `test/smoke/tier1-infrastructure.smoke.test.ts` with sequential describe blocks. Each describe block tests one infrastructure concern. The test file uses the smoke helpers from `test/smoke/helpers/` and skips if prerequisites are not met.

The tests in this tier are **stateful and sequential** -- later tests depend on earlier ones succeeding (e.g., you cannot test port-forwarding without a deployed service). Vitest's `.sequential` modifier enforces this.

**Test structure:**
1. Container runtime verification (docker info, docker build)
2. Cluster operations (k3d cluster exists, kubectl reachable)
3. Image loading (k3d image import)
4. Helm deployment (install chart, wait for pods)
5. Port-forward establishment (bind, verify with TCP check)
6. Namespace isolation (two namespaces, no cross-talk)

Cleanup happens in `afterAll` -- delete the test namespaces and uninstall Helm releases.

## Steps
1. Create `test/smoke/tier1-infrastructure.smoke.test.ts`
2. Write container runtime tests (docker info, build one stub service)
3. Write cluster tests (cluster exists after global setup, kubectl cluster-info succeeds)
4. Write image load tests (k3d image import, verify image exists in cluster)
5. Write Helm deploy tests (helm install, kubectl wait for deployments)
6. Write port-forward tests (start forward, TCP health check, HTTP health check on /health)
7. Write namespace isolation tests (deploy in two namespaces, verify no DNS cross-resolution)
