---
title: Frontend Fixture (Vite + React)
status: done
description: >-
  Minimal Vite+React app with login page and authenticated data page, using Vite
  proxy to reach smoke-api
depends_on:
  - smoke-stub-services
tags:
  - smoke
  - fixtures
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:53.650Z'
started_at: '2026-02-21T17:58:42.358Z'
completed_at: '2026-02-21T18:00:20.129Z'
---

## Problem
The smoke test suite needs a frontend fixture to validate Grove's frontend dev server orchestration: Vite startup, port injection via `PORT` env var, proxy configuration to reach backend services, and the full auth round-trip from browser to API.

Grove's `GenericDevServer` (in `src/environment/frontends/GenericDevServer.ts`) spawns the frontend command with `PORT` injected and resolves template variables like `{{ports.smoke-api}}` in the env config. The smoke tests need a real Vite dev server that exercises this machinery.
## Approach
Create a minimal Vite + React app at `test/smoke/fixtures/frontend/`. This is intentionally bare-bones -- no routing library, no state management, just enough to test:

1. **Vite dev server starts** on the `PORT` env var
2. **Vite proxy** forwards `/api/*` requests to `smoke-api` (port injected via `GROVE_API_PORT` env var)
3. **Login flow** -- POST to `/api/login`, receive JWT, store in memory
4. **Authenticated data fetch** -- GET `/api/data` with Bearer token
5. **Health endpoint** -- Vite serves `index.html` at `/`, which Grove's health check can hit

**No Playwright dependency** for Tier 3 tests. The frontend tests use HTTP fetch against the Vite dev server's endpoints (the Vite proxy handles forwarding). This avoids adding a heavy browser dependency. The Vite dev server serves the HTML/JS and proxies API calls -- we test the proxy behavior with HTTP requests, not browser rendering.

**Dependencies**: The frontend fixture has its own `package.json` with `vite`, `react`, `react-dom`, `@vitejs/plugin-react`. These are devDependencies of the fixture, not of Grove itself. The smoke test helper runs `npm install` in the fixture directory as part of setup.

## Steps
1. Create `test/smoke/fixtures/frontend/package.json` with vite + react deps
2. Create `test/smoke/fixtures/frontend/vite.config.js` with proxy config using `GROVE_API_PORT`
3. Create `test/smoke/fixtures/frontend/index.html` -- minimal HTML entry
4. Create `test/smoke/fixtures/frontend/src/App.jsx` -- login + data page
5. Create `test/smoke/fixtures/frontend/src/main.jsx` -- React entry
6. Add frontend config to `test/smoke/fixtures/smoke.grove.yaml`
7. Verify Vite dev server starts with `PORT=5555 npm run dev`
