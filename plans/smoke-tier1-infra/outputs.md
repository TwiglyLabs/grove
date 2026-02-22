
## Test suite
`test/smoke/tier1-infrastructure.smoke.test.ts` — validates foundational infrastructure layer:
- Container runtime reachable and responsive
- Kind cluster creation and deletion succeed
- Docker images build and load into kind without error
- Helm chart deploys successfully into a fresh namespace
- Port-forward establishes TCP connectivity to deployed services
- Namespace isolation: resources in `tier1` namespace do not affect `default`

## Proof delivered
Tier 1 passing proves the infrastructure foundations are solid for higher tiers:
- `smoke-tier2-mesh` can assume cluster exists, images are loaded, and Helm chart is deployed
- `smoke-health-hardening` port-forward verification logic is exercised at the infra level
- Any regression in cluster setup, image loading, or Helm deployment is caught here before mesh or frontend tests run

## Pattern established
Tier gate pattern: each smoke tier's test file is a precondition for the next tier. Tier 1 does not test service behavior — only that the substrate (cluster, images, Helm, port-forward) works. This keeps failure diagnosis fast: a tier-1 failure points to infrastructure, not service code.
