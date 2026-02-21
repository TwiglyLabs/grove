---
title: Cluster Abstraction
status: not_started
description: >-
  Extract cluster provider into a strategy pattern supporting kind, k3s, and
  remote clusters
depends_on:
  - clean-library-api
tags:
  - deferred
not_started_at: '2026-02-21T02:02:32.571Z'
---

## Problem
Grove is hardcoded to `kind` for cluster management. Running 5-10+ parallel environments will likely hit kind's resource overhead. k3s is lighter weight, and eventually you may want remote clusters. Currently switching would require rewriting environment internals.

**Deferral note:** The current cluster code is ~30 lines in `environment/cluster.ts` (two functions). The refactor surface is small. This plan is worth doing when you're actually hitting kind's limits or have a concrete need for k3s/remote — not before. Extracting the interface now would be premature abstraction over a tiny surface area.
## Approach
Extract a `ClusterProvider` interface with a small surface area:

```typescript
interface ClusterProvider {
  createCluster(name: string): Promise<void>
  deleteCluster(name: string): Promise<void>
  getKubeconfig(name: string): Promise<string>
  clusterExists(name: string): Promise<boolean>
}
```

Implement `KindProvider` (extract from current code) and `K3sProvider`. Add a `cluster` field to project config:

```yaml
project:
  cluster: k3s  # 'kind' | 'k3s' | 'remote'
```

All environment operations use the provider interface. Switching clusters becomes a config change.

## Steps
1. Define `ClusterProvider` interface in environment types
2. Extract current kind-specific code into `KindProvider`
3. Update environment API to use provider interface instead of direct kind calls
4. Implement `K3sProvider`
5. Add provider selection logic based on project config
6. Stub `RemoteProvider` interface for future use
7. Tests: verify environment operations work against mock provider
