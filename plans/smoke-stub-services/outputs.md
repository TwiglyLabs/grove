
## Test fixtures
`test/smoke/fixtures/services/` — four minimal Node.js stub services:
- `smoke-auth/` — issues JWT tokens; `POST /token` accepts credentials, returns signed JWT
- `smoke-api/` — verifies JWT from `smoke-auth`; `GET /data` returns structured payload
- `smoke-agent/` — calls `smoke-api` with forwarded auth; `GET /agent-data` proxies and transforms
- `smoke-mcp/` — downstream of `smoke-agent`; `GET /mcp-data` represents end-of-chain service

Each service is a standalone `package.json` with a single `index.js` entry point and no external runtime deps.

## Helm chart
`test/smoke/fixtures/helm/grove-smoke/` — Helm chart deploying all four services:
- One `Deployment` + `Service` per stub
- `ConfigMap` for inter-service URLs (injected as env vars)
- `Secret` for JWT signing key (shared between `smoke-auth` and `smoke-api`)
- Values file parameterizes image tags and replica counts

## Grove config
`test/smoke/fixtures/smoke.grove.yaml` — root grove config for the smoke test workspace:
```yaml
services:
  - name: smoke-auth
    port: 8081
    healthPath: /healthz
  - name: smoke-api
    port: 8082
    healthPath: /healthz
  - name: smoke-agent
    port: 8083
    healthPath: /healthz
  - name: smoke-mcp
    port: 8084
    healthPath: /healthz
```
Consumed by smoke-test-infra, smoke-tier1-infra, smoke-tier2-mesh, and smoke-frontend-fixture.

## Pattern established
Self-contained smoke topology: all four stubs are independently deployable, have no external deps, and implement a realistic JWT auth chain (`auth → api → agent → mcp`). The Helm chart is the single deploy artifact consumed by `smoke-test-infra` global setup and validated by `smoke-tier1-infra` and `smoke-tier2-mesh`.
