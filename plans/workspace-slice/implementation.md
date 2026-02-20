## Steps
### Consolidate types

1. Update `src/workspace/types.ts`: add all public types from `src/api/types.ts` (CreateOptions, CreateResult, ListOptions, WorkspaceListEntry, WorkspaceStatusResult, SyncOptions, SyncResult, CloseMode, CloseOptions, DryRunResult, CloseResult)
2. Add `WorkspaceEvents` interface (from `src/api/events.ts`)
3. Run tests

### Move sanitization

4. Move `src/sanitize.ts` → `src/workspace/sanitize.ts`. Update imports
5. Move `src/sanitize.test.ts` → `src/workspace/sanitize.test.ts`
6. Run tests

### Consolidate API

7. Create `src/workspace/api.ts` with public API: `create()`, `list()`, `getStatus()`, `sync()`, `close()`. Pull logic from `src/api/workspace.ts`
8. Move/merge `src/api/workspace.ts` tests into colocated tests
9. Run tests

### Config ownership

10. Create `src/workspace/config.ts` — move `WorkspaceConfigSchema`, `WorkspaceRepoSchema` from root `config.ts`. Export `loadWorkspaceConfig()`
11. Update root `src/config.ts` to import workspace schema from slice
12. Run tests

### Create CLI subcommand

13. Create `src/workspace/cli.ts` — commander `Command` for `grove workspace` with subcommands `create`, `list`, `status`, `sync`, `close`. Move arg parsing and output formatting from `src/commands/workspace.ts`
14. Register in `src/cli.ts`
15. Move `src/commands/workspace.test.ts` tests into `src/workspace/cli.test.ts`
16. Run tests

### Wire and cleanup

17. Update `src/index.ts` to re-export `import * as workspace from './workspace/api.js'`
18. Remove `src/api/workspace.ts`, `src/commands/workspace.ts`, workspace types from `src/api/types.ts`, `WorkspaceEvents` from `src/api/events.ts`
19. Run full test suite — all must pass
20. Build and verify no type errors

## Testing
- All existing workspace tests pass — now colocated in `src/workspace/`
- Sanitize tests pass in new location
- `grove workspace create`, `list`, `status`, `sync`, `close` all work via commander
- Library consumers can `import { workspace } from 'grove'` and call workspace API
- WorkspaceEvents callbacks fire correctly during operations
- Build succeeds with no type errors

## Done-when
- `src/workspace/` contains types.ts, state.ts, git.ts, preflight.ts, create.ts, sync.ts, close.ts, status.ts, sanitize.ts, config.ts, api.ts, cli.ts, and colocated tests
- `src/api/workspace.ts`, `src/commands/workspace.ts`, `src/sanitize.ts` are deleted
- Workspace types removed from `src/api/types.ts`, `WorkspaceEvents` removed from `src/api/events.ts`
- Root config imports workspace schema from slice
- All tests pass, build succeeds
