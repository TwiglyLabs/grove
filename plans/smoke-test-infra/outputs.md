
## Test infrastructure
`vitest.smoke.config.ts` at repo root — separate vitest config for smoke tests:
- `include: ['test/smoke/**/*.smoke.test.ts']`
- `globalSetup: 'test/smoke/helpers/globalSetup.ts'`
- `testTimeout: 120_000` (2 minutes per test)
- `pool: 'forks'` (isolation between tiers)

`package.json` script:
- `npm run test:smoke` — runs `vitest run --config vitest.smoke.config.ts`

## Smoke test helpers
`test/smoke/helpers/` — shared utilities imported by all smoke test tiers:
- `prerequisites.ts` — `checkPrerequisites()` asserts docker, kubectl, helm are available
- `cluster.ts` — `createCluster()` / `deleteCluster()` wraps kind cluster lifecycle
- `images.ts` — `buildAndLoadImages(cluster)` builds stub service Docker images and loads into kind
- `deploy.ts` — `deployChart(cluster, namespace)` runs `helm install` for grove-smoke chart
- `port-forward.ts` — `startPortForward(service, port)` / `stopPortForward()` manage kubectl tunnels
- `http.ts` — `get(url)`, `post(url, body)` minimal fetch wrappers with retry
- `cleanup.ts` — `cleanupAll()` deletes namespaces, port-forwards, and cluster

## Global setup / teardown
`test/smoke/helpers/globalSetup.ts` — vitest global setup:
- `setup()`: runs prerequisites check, creates shared kind cluster, builds and loads images
- `teardown()`: calls `cleanupAll()` to remove all smoke test resources

The shared cluster is created once and reused across all tiers. Each tier creates its own namespace for isolation.

## Pattern established
Namespace-per-tier isolation: each smoke test tier (`tier1`, `tier2`, etc.) deploys into its own Kubernetes namespace, allowing tiers to run sequentially without resource collisions. Shared cluster amortizes creation cost. Helper modules are the single import source for all tier tests — no duplicated kubectl/helm invocations in test files.
