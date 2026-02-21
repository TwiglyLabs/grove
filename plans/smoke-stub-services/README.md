---
title: Stub Services and Helm Chart
status: done
description: >-
  Four Node.js stub services (auth, api, agent, mcp) with Dockerfiles, plus a
  Helm chart deploying all four with inter-service wiring
tags:
  - smoke
  - fixtures
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:52.106Z'
started_at: '2026-02-21T17:52:59.163Z'
completed_at: '2026-02-21T18:11:01.318Z'
---

## Problem
The smoke test suite needs real services running in Kubernetes to validate Grove's orchestration end-to-end. These services must:
- Be small enough to build and deploy in seconds (not minutes)
- Have realistic inter-service communication (HTTP calls, auth tokens, dependency chains)
- Expose health endpoints for Grove's health check system
- Fail predictably when dependencies are down (502 errors, not hangs)
- Be packaged as Docker images loadable into k3d

The existing integration test fixture (`test/integration/fixtures/minimal.grove.yaml`) references a single nginx service. This is insufficient for testing service mesh behavior, auth flows, or dependency chains.
## Approach
Create four Node.js stub services (each ~50 lines of `server.js`) under `test/smoke/fixtures/services/`. Each service is a plain `http.createServer` with no npm dependencies -- just Node.js stdlib. This keeps Docker builds under 5 seconds.

The service topology models a realistic microservice architecture:

```
[smoke-auth] <-- [smoke-api] --> [smoke-agent] --> [smoke-mcp]
     |                |                |                |
   /health          /health          /health          /health
   /login           /data            /execute          /tools
   /verify          /agent/run
```

**Inter-service communication via environment variables:**
- `smoke-api` receives `AUTH_URL` and `AGENT_URL`
- `smoke-agent` receives `MCP_URL`
- All URLs are injected by the Helm chart as K8s environment variables pointing to ClusterIP services

**Auth flow:**
- `smoke-auth /login` returns a JWT (signed with HMAC-SHA256 using a shared secret from a K8s Secret)
- `smoke-api /data` requires `Authorization: Bearer <token>`, validates by calling `smoke-auth /verify`
- The JWT is a simple base64 JSON payload with HMAC signature -- no `jsonwebtoken` dependency needed

**Helm chart** at `test/smoke/fixtures/helm/grove-smoke/` deploys all four services with proper wiring.

**Grove config** at `test/smoke/fixtures/smoke.grove.yaml` declares the full topology for Grove to orchestrate.

## Steps
1. Create `test/smoke/fixtures/services/smoke-auth/server.js` and `Dockerfile`
2. Create `test/smoke/fixtures/services/smoke-api/server.js` and `Dockerfile`
3. Create `test/smoke/fixtures/services/smoke-agent/server.js` and `Dockerfile`
4. Create `test/smoke/fixtures/services/smoke-mcp/server.js` and `Dockerfile`
5. Create Helm chart at `test/smoke/fixtures/helm/grove-smoke/` (Chart.yaml, values.yaml, templates/)
6. Create `test/smoke/fixtures/smoke.grove.yaml` -- Grove config for the smoke topology
7. Verify each service works standalone with `node server.js` and curl
8. Verify Docker builds succeed for all four services
9. Verify Helm chart templates render correctly with `helm template`
