
## Test suite
`test/smoke/tier2-service-mesh.smoke.test.ts` — validates inter-service communication layer:
- DNS resolution: services reach each other by Kubernetes service name
- Multi-service deploy: all four stubs deploy and become healthy simultaneously
- Secret injection: JWT signing key from `Secret` is available to `smoke-auth` and `smoke-api`
- Auth chain: `POST /token` on smoke-auth returns a valid JWT accepted by smoke-api
- Dependency chain: `smoke-api → smoke-agent → smoke-mcp` call chain completes end-to-end
- Error propagation: a downstream failure surfaces the correct HTTP error code at the top of the chain
- Service restart resilience: killing and restarting one pod does not permanently break the chain

## Proof delivered
Tier 2 passing proves inter-service communication is correct for higher tiers:
- `smoke-tier3-frontend` can assume the API chain responds correctly to authenticated requests
- `smoke-tier4-resilience` can assume baseline mesh behavior before injecting failure scenarios
- `smoke-tier5-lifecycle` can assume steady-state mesh behavior before testing grove lifecycle operations

## Pattern established
Chain validation pattern: tier 2 tests make real HTTP calls through the full auth → api → agent → mcp chain rather than testing services in isolation. This validates grove's service topology wiring (DNS, secrets, env injection) end-to-end. Downstream tiers inherit this chain as a known-good baseline.
