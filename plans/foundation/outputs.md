## Directory layout

```
src/
  shared/
    identity.ts    — RepoId, WorkspaceId branded types
    errors.ts      — GroveError base class and subclasses
    output.ts      — chalk formatting helpers
  repo/            — empty, ready for repo-slice plan
  workspace/       — empty, ready for workspace-slice plan
  environment/     — empty, ready for environment-slice plan
  testing/         — empty, ready for testing slice
  shell/           — empty, ready for shell slice
  logs/            — empty, ready for logs slice
  simulator/       — empty, ready for simulator slice
  request/         — empty, ready for request-slice plan
  config.ts        — root config compositor (reads .grove.yaml, delegates to domain schemas)
  cli.ts           — commander program with subcommand registration
  index.ts         — public API re-exports (entry point for library consumers)
```

## Shared infrastructure
- `src/shared/identity.ts` — `RepoId`, `WorkspaceId` branded types with `isRepoId`, `asRepoId`, `asWorkspaceId` helpers (from `src/api/identity.ts`)
- `src/shared/errors.ts` — `GroveError` and all typed error subclasses (from `src/api/errors.ts`)
- `src/shared/output.ts` — `printInfo`, `printSuccess`, `printError`, `printSection`, `printWarning` (from `src/output.ts`)
- `src/shared/config.ts` — `load(repoId)` and `loadWorkspaceConfig(repoId)` — config loading with RepoId→path resolution (from `src/api/config.ts`)
## Config compositor pattern

Root `src/config.ts` provides:
- `loadConfig(rootDir?)` — parses `.grove.yaml`, validates, returns typed config
- `loadWorkspaceConfig(repoRoot)` — workspace-only partial parse
- Domain schemas are composed via `z.object({ ... })` from fragments each domain exports

## Commander CLI skeleton

`src/cli.ts` exports a configured commander `program` that:
- Handles `--version`, `--help`
- Registers subcommands that delegate to existing command functions
- Provides `resolveCurrentRepo()` as shared CLI utility for commands that need a RepoId

## CLAUDE.md

Project-level CLAUDE.md documenting architecture, conventions, development workflow, and quality gates.
