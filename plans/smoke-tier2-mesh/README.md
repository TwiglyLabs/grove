---
title: 'Smoke Tier 2: Service Mesh Tests'
status: done
description: >-
  DNS resolution, multi-service helm deploy, config/secret injection, service
  restart resilience, inter-service HTTP calls
depends_on:
  - smoke-tier1-infra
tags:
  - smoke
  - testing
  - 'epic:smoke-tests'
type: feature
not_started_at: '2026-02-21T17:42:54.906Z'
completed_at: '2026-02-21T18:11:15.486Z'
---

## Problem
Tier 1 proved that individual infrastructure components work (build, deploy, forward). Tier 2 tests whether the services can talk to each other inside the cluster -- the "service mesh" behavior that Grove's real workloads depend on.

The critical questions:
- Can `smoke-api` reach `smoke-auth` via K8s DNS (`http://smoke-auth:3000/verify`)?
- Can `smoke-api` reach `smoke-agent` via K8s DNS?
- Can `smoke-agent` reach `smoke-mcp` via K8s DNS?
- Are K8s Secrets (JWT signing key) properly injected?
- Does the full auth chain work end-to-end (login -> get token -> call authenticated endpoint)?
- Do services return proper errors when dependencies are down (502 vs hang)?
## Approach
A single test file `test/smoke/tier2-service-mesh.smoke.test.ts` with sequential describe blocks. Deploy all four services in a fresh namespace, port-forward the entry points (`smoke-auth` and `smoke-api`), and test the full dependency chain from outside the cluster.

**Test strategy:**
- Deploy once in `beforeAll`, tear down in `afterAll`
- Port-forward `smoke-auth` and `smoke-api` only (the internal services are only reachable within the cluster -- that is the point)
- Test inter-service communication by calling `smoke-api /agent/run` which internally calls `smoke-agent /execute` which internally calls `smoke-mcp /tools`
- Test failure propagation by deleting `smoke-agent` deployment and verifying `smoke-api /agent/run` returns 502
- Test K8s Secret injection by verifying JWT validation works (the auth service uses the secret from the K8s Secret resource)

## Steps
1. Create `test/smoke/tier2-service-mesh.smoke.test.ts`
2. Write DNS resolution tests (api can reach auth, agent can reach mcp via service names)
3. Write multi-service deploy test (all four pods running, all healthy)
4. Write secret injection test (login, verify token -- proves JWT_SECRET was injected)
5. Write auth chain test (login -> call /data with Bearer token -> 200)
6. Write dependency chain test (call /agent/run -> response includes tools from MCP)
7. Write error propagation test (delete agent, call /agent/run -> 502)
8. Write service restart resilience test (delete auth pod, wait for restart, verify auth works again)
