---
title: 'Smoke Tier 3: Frontend Integration Tests'
status: done
description: >-
  Dev server startup+readiness, frontend-to-API fetch via proxy, auth
  round-trip, CORS test, hot reload latency
depends_on:
  - smoke-tier2-mesh
  - smoke-frontend-fixture
tags:
  - smoke
  - testing
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:55.298Z'
completed_at: '2026-02-21T18:11:20.327Z'
---

## Problem
Grove orchestrates frontend dev servers via `GenericDevServer`, which spawns the command with `PORT` injected and template-resolved env vars. The smoke tests need to verify this machinery works end-to-end:

- Vite starts on the correct port (the one Grove allocates)
- Vite proxy forwards `/api/*` to the backend service (using `GROVE_API_PORT` resolved from `{{ports.smoke-api}}`)
- The full auth round-trip works through the proxy (login via frontend proxy -> get token -> fetch data)
- The frontend health check works (Grove hits `/` and gets a 200)

This tier also validates Colima's VirtioFS file-sharing performance. Vite's hot reload depends on filesystem events propagating from the host into the container runtime. If VirtioFS introduces multi-second latency, hot reload is broken for real development.
## Approach
Deploy the backend services in K8s (reuse the Helm chart), start the Vite frontend **on the host** (not in K8s -- this matches how Grove runs frontends), and test the proxy chain.

The frontend is NOT containerized. Grove's `GenericDevServer` runs frontend commands directly on the host machine. The Vite dev server runs on the host, proxying API calls to the port-forwarded backend services.

**Test approach (no Playwright):**
- Use HTTP fetch against the Vite dev server
- Test that `GET /` returns HTML (health check)
- Test that `POST /api/login` is proxied to smoke-api (which calls smoke-auth internally)
- Test that `GET /api/data` with Bearer token is proxied and returns data
- For hot reload latency, write a file in the frontend fixture, measure time until Vite serves updated content

**Why no Playwright:** Adding Playwright would introduce a ~200MB dependency, require browser installation, and significantly slow the test suite. The critical behavior we are testing is the Vite proxy + Grove port wiring, not browser rendering. HTTP fetch tests cover this adequately. If browser-specific issues arise later (CORS, cookies), Playwright can be added as a separate optional tier.

## Steps
1. Create `test/smoke/tier3-frontend.smoke.test.ts`
2. Write test setup: deploy backend in K8s, port-forward smoke-api and smoke-auth
3. Write Vite startup test: spawn `npm run dev` with PORT and GROVE_API_PORT env vars, wait for health
4. Write health check test: GET / returns 200 with HTML content
5. Write proxy test: POST /api/login returns JWT (proves Vite proxy -> smoke-api -> smoke-auth chain)
6. Write auth round-trip test: login, then GET /api/data with Bearer token
7. Write CORS test: direct fetch to smoke-api port (not through Vite) to verify CORS headers
8. Write hot reload latency test: modify a file, measure time until Vite serves change
9. Clean up: kill Vite process, stop port-forwards, tear down K8s resources
