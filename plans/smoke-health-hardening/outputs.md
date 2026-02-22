
## Public API
`src/environment/api.ts` exports:
- `healthCheckAll(workspaceId: WorkspaceId): Promise<HealthCheckResult[]>` — runs health checks against all services in the workspace, returns one `HealthCheckResult` per service

`up()` options extended:
- `UpOptions.strict?: boolean` — when true, any health check failure causes `up()` to throw `PortForwardFailedError` rather than returning a degraded `UpResult`

## Types
`src/environment/types.ts` exports:
- `HealthCheckResult` — `{ service: string, healthy: boolean, statusCode?: number, error?: Error, durationMs: number }`
- `UpResult.health` — new field: `HealthCheckResult[]` appended to the existing `UpResult` type
- `PortForwardFailedError extends GroveError` — thrown when TCP connectivity check fails after port-forward spawn

`src/environment/types.ts` config additions:
- `readinessPath?: string` — per-service config field specifying the HTTP path used for readiness probing (defaults to `/healthz`)

## Infrastructure hardening
Port-forward verification: after spawning a `kubectl port-forward` process, a TCP connection attempt is made to confirm the tunnel is live before `up()` returns. This catches cases where `kubectl` exits silently or the pod is not yet ready.

`readinessPath` config enables per-service customization of the health probe endpoint, consumed by `smoke-tier1-infra` tests.

## Pattern established
Structured health results on `UpResult`: downstream plan `smoke-tier1-infra` asserts on `UpResult.health` to verify all services are healthy after environment bring-up, using the `HealthCheckResult[]` array to produce per-service test assertions.
