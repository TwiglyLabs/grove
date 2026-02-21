---
title: Smoke Test Infrastructure
status: done
description: >-
  vitest.smoke.config.ts, npm script, smoke test helpers (cluster lifecycle,
  image build, helm deploy, port-forward management, cleanup)
depends_on:
  - smoke-preflight
tags:
  - smoke
  - testing
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:53.092Z'
completed_at: '2026-02-21T18:11:10.197Z'
---

## Problem
The smoke tests need their own vitest configuration, npm script, and helper library. The existing test infrastructure provides two reference points:

- **Integration tests** (`vitest.integration.config.ts`, 120s timeout) with helpers for cluster prerequisite checking, repo scaffolding, and assertions
- **E2E tests** (`vitest.e2e.config.ts`, 30s timeout) for CLI-level tests

Smoke tests are heavier than both -- they build Docker images, deploy Helm charts, create and destroy clusters. They need:
- Longer timeouts (300s per test, 60s for hooks)
- Cluster lifecycle management (create/destroy the smoke cluster)
- Image build helpers (build all four stub services)
- Helm deploy/undeploy helpers
- Port-forward management helpers
- A cleanup function that tears everything down regardless of test outcome
- The ability to skip gracefully when prerequisites are not met
## Approach
Follow the established pattern: `vitest.smoke.config.ts` at the repo root, `npm run test:smoke` script, helpers in `test/smoke/helpers/`.

**Key design decisions:**

1. **Single shared cluster** across all tiers -- Creating a k3d cluster takes 15-30s. All tiers share one cluster (`grove-smoke`) created in a global setup and destroyed in global teardown. This is managed via vitest's `globalSetup` file.

2. **Namespace-per-tier isolation** -- Each tier gets its own namespace so tests don't interfere. Tier 1 uses `smoke-t1`, Tier 2 uses `smoke-t2`, etc.

3. **Image builds are cached** -- Docker layer caching means rebuilds after the first are fast. The global setup builds all four images once.

4. **Sequential execution** -- Smoke tests run sequentially (`pool: 'forks'`, `poolOptions.forks.singleFork: true`). Parallel execution across tiers would fight over cluster resources.

5. **Prerequisite gating** -- Reuse the `canRunIntegrationTests()` pattern from `test/integration/helpers/cluster.ts`, extended to check for `k3d` specifically (since smoke tests use k3d/Colima, not kind).

## Steps
1. Create `vitest.smoke.config.ts` at repo root
2. Add `test:smoke` script to `package.json`
3. Create `test/smoke/helpers/prerequisites.ts` -- extended prerequisite checks for Colima/k3d
4. Create `test/smoke/helpers/cluster.ts` -- cluster create/delete, namespace management
5. Create `test/smoke/helpers/images.ts` -- Docker build + k3d image load
6. Create `test/smoke/helpers/deploy.ts` -- Helm install/uninstall, wait for deployments
7. Create `test/smoke/helpers/port-forward.ts` -- start/stop/verify port forwards
8. Create `test/smoke/helpers/http.ts` -- HTTP client helpers for testing service endpoints
9. Create `test/smoke/helpers/cleanup.ts` -- comprehensive teardown
10. Create `test/smoke/globalSetup.ts` -- build images, create cluster
11. Create `test/smoke/globalTeardown.ts` -- delete cluster
12. Create `test/smoke/README.md` -- documentation
