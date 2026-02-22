
## Public API
`src/workspace/api.ts` exports:
- `describe(workspaceId: WorkspaceId): Promise<EnvironmentDescriptor>` — returns full structured description of a workspace environment including services, frontends, testing commands, and shell targets

## Types
`src/workspace/types.ts` exports:
- `EnvironmentDescriptor` — top-level descriptor: `{ workspaceId, repos, services, frontends, testingCommands, shellTargets }`
- `ServiceDescriptor` — per-service info: `{ name, namespace, port, healthPath, status }`
- `FrontendDescriptor` — per-frontend info: `{ name, url, proxyTarget }`
- `ShellTarget` — `{ name, namespace, podSelector }`

All types exported from `src/lib.ts`.

## CLI command
`grove workspace describe [workspace-id]` — prints a human-readable summary of the workspace environment. Registered in `src/workspace/cli.ts` and imported by `src/cli.ts`.

## Pattern established
Structured environment introspection: downstream plans (integration-harness) can call `describe()` to programmatically enumerate services and endpoints rather than re-parsing config. `EnvironmentDescriptor` serves as the canonical runtime snapshot of what a workspace exposes.
