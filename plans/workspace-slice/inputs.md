## From plans

- **repo-slice** — `repo.get(id)`, `repo.findByPath()` for resolving repo paths from IDs. `RepoId` type from shared identity.

## From existing code
- `src/workspace/create.ts`, `close.ts`, `sync.ts`, `git.ts`, `preflight.ts`, `state.ts`, `status.ts`, `types.ts` — current workspace implementation
- `src/api/workspace.ts` — current public API wrapper
- `src/api/types.ts` — workspace type definitions (CreateOptions, CreateResult, etc.)
- `src/api/events.ts` — `WorkspaceEvents` callback interface (`onProgress`, `onConflict`, `onError`)
- `src/commands/workspace.ts` + `src/commands/workspace.test.ts` — current CLI command and tests
- `src/config.ts` — `WorkspaceConfig` schema and `loadWorkspaceConfig()` function
- `src/sanitize.ts` + `src/sanitize.test.ts` — branch name sanitization used by workspace creation
