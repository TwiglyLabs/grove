# Integration Tests

End-to-end tests that exercise the full parallel provisioning flow against a real Kubernetes cluster. These are **not** run in CI — they require local infrastructure.

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| Docker | Yes | Container runtime for kind/k3s |
| kubectl | Yes | Kubernetes CLI |
| helm | Yes | Helm chart deployment |
| kind **or** k3s | Yes | Local Kubernetes cluster |

## Running

```bash
# Ensure a cluster is running first
kind create cluster --name grove-integration

# Run integration tests
npm run test:integration
```

## What It Tests

The `full-lifecycle` test exercises the complete parallel provisioning flow:

1. **Scaffold** — creates temporary git repos with a minimal `.grove.yaml`
2. **Register** — adds repos to the grove registry
3. **Create workspaces** — creates 3 workspaces in parallel via `workspace.create()`
4. **Bring up environments** — runs `environment.up()` on each, allocating ports/namespaces
5. **Describe** — calls `workspace.describe()`, verifies no port/namespace overlap
6. **Health check** — verifies services are reachable at assigned URLs
7. **Destroy** — tears down all environments via `environment.destroy()`
8. **Prune** — runs `environment.prune()`, verifies zero orphans

## Port Requirements

Grove allocates ports starting at **10000** in contiguous blocks. Each workspace gets its own block. Ensure ports 10000–10100 are available.

## Skipping

Tests skip automatically if prerequisites are not met. The test suite checks for required tools and a reachable cluster before running.
