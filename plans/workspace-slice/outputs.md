## Public API

`src/workspace/api.ts` exports:
- `create(branch: string, opts: CreateOptions): Promise<CreateResult>`
- `list(opts?: ListOptions): Promise<WorkspaceListEntry[]>`
- `getStatus(id: WorkspaceId): WorkspaceStatusResult`
- `sync(id: WorkspaceId, opts?: SyncOptions): Promise<SyncResult>`
- `close(id: WorkspaceId, mode: CloseMode, opts?: CloseOptions): Promise<CloseResult>`

## Types
`src/workspace/types.ts` exports all workspace-related types consumed by canopy and the CLI, including:
- Zod schemas: `WorkspaceState`, `WorkspaceRepoState`, `SyncState`
- TS types: `CreateOptions`, `CreateResult`, `ListOptions`, `WorkspaceListEntry`, `WorkspaceStatusResult`, `SyncOptions`, `SyncResult`, `CloseMode`, `CloseOptions`, `DryRunResult`, `CloseResult`
- Event interface: `WorkspaceEvents` (`onProgress`, `onConflict`, `onError`) — moved from `src/api/events.ts`
## Config ownership

`src/workspace/config.ts` owns the `WorkspaceConfigSchema` (repos array) and exports `loadWorkspaceConfig()`.

## CLI subcommand

`src/workspace/cli.ts` exports a commander `Command` for `grove workspace` with subcommands `create`, `list`, `status`, `sync`, `close`.
