---
title: Environment Descriptor
status: done
description: >-
  Add a describe() function that returns everything an agent needs — worktree
  paths, service URLs, test commands, health status, log paths
depends_on:
  - setup-automation
tags:
  - api
  - canopy
not_started_at: '2026-02-21T02:02:30.661Z'
completed_at: '2026-02-21T04:20:13.379Z'
---

## Problem
When Canopy hands a workspace to a Claude instance, Claude needs to know: where are the repos, what URLs are the services on, how do I run tests, where are the logs? Today this information is scattered across workspace state, environment state, and config. There's no single call that returns a complete picture.
## Approach
Add a `describe()` function that composes information from workspace state, environment state, and config into a single `EnvironmentDescriptor` object:

```typescript
interface EnvironmentDescriptor {
  workspace: {
    id: WorkspaceId
    branch: string
    repos: Array<{ name: string; path: string; role: 'parent' | 'child' }>
  }
  services: Array<{
    name: string
    url: string
    port: number
  }>
  frontends: Array<{ name: string; url: string; cwd: string }>
  testing: { commands: Record<string, string> }  // platform → command
  shell: { targets: string[] }
}
```

This becomes the handoff payload Canopy gives to Claude.

**Scope decisions:**
- **No `healthy` field on services.** Grove doesn't have health checking today. Adding it here would be hidden new work. Health checking can be a follow-up plan if needed.
- **No `logs.paths` field.** Logs are streamed via `kubectl logs`, not written to local files. If log state is needed, it's the streaming handle, not a path.
- **Lives in `workspace/` slice** since it takes a `WorkspaceId` and composes workspace-centric information. It imports from environment state as a data source.
## Steps
1. Define `EnvironmentDescriptor` type and sub-types in `workspace/types.ts`
2. Implement `describe(workspaceId: WorkspaceId)` in `workspace/api.ts`
3. Read workspace state via `readWorkspaceState()` — extract id, branch, repos
4. Read environment state via environment's `readState()` — extract ports, URLs, processes
5. Read config via `loadConfig()` — extract testing commands, shell targets, frontend config
6. Compose service list from environment state ports/URLs + config service definitions
7. Compose frontend list from environment state + config frontend definitions
8. Export `describe` and `EnvironmentDescriptor` from `src/lib.ts`
9. Add `describe` subcommand to workspace CLI (`grove workspace describe <id>`)
10. Tests: mock workspace state + environment state + config, verify descriptor contains all expected fields
