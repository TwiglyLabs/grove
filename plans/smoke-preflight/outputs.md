
## Public API
`src/environment/preflight.ts` exports:
- `runPreflightChecks(config: GroveConfig): Promise<PreflightResult>` — validates all prerequisites before environment bootstrap begins; throws `PreflightFailedError` on any failing check

Wired into `ensureEnvironment()` as the first step before any bootstrap logic runs.

## Types
`src/environment/preflight.ts` exports:
- `PreflightCheck` — `{ name: string, passed: boolean, message?: string }` result of a single check
- `PreflightResult` — `{ checks: PreflightCheck[], allPassed: boolean }` aggregate result
- `PreflightFailedError extends GroveError` — thrown when one or more checks fail; carries the full `PreflightResult` for diagnostic output

## Checks performed
Standard preflight checks run before bootstrap:
- Docker / container runtime reachable
- `kubectl` binary present and cluster reachable
- `helm` binary present
- Required config fields populated (repos, services)
- No conflicting port reservations in current state

## Pattern established
Fail-fast before mutation: by running `runPreflightChecks()` as the first step in `ensureEnvironment()`, downstream smoke tiers (smoke-health-hardening, smoke-tier1-infra) can rely on the environment only being mutated when prerequisites are confirmed. `PreflightFailedError` carries structured check results for test assertions.
