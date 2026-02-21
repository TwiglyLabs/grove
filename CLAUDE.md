# Grove

Config-driven local Kubernetes development tool. Manages development environments, multi-repo workspaces, testing, and service orchestration.

**Freshness:** 2026-02-20

## Architecture

Grove uses a **vertical slice architecture**. Each domain owns its schema, commands, API surface, and tests.

### Directory Structure

```
src/
  shared/           Cross-cutting infrastructure (identity, errors, output, config loader)
  repo/             Repo registry management
  workspace/        Multi-repo workspace operations
  environment/      Environment lifecycle (up, down, destroy, watch, status, prune, reload)
  testing/          Test runner and result parsing
  simulator/        iOS simulator management
  shell/            Shell into service pods
  logs/             Log streaming
  request/          Cross-repo plan requests
  config.ts         Root config compositor — composes zod schemas from slices
  cli.ts            Commander CLI skeleton — imports from slice cli.ts files
  lib.ts            Public library API — re-exports from slices
  index.ts          CLI entry point (parses args via commander)
```

### Slice Structure

Each slice follows a consistent pattern:

- `types.ts` — Domain types, zod schemas, interfaces
- `api.ts` — Public API functions
- `cli.ts` — CLI command registration (imported by `src/cli.ts`)
- `*.test.ts` — Colocated tests

### Shared Infrastructure (`src/shared/`)

- `identity.ts` — `RepoId`, `WorkspaceId` branded types
- `errors.ts` — `GroveError` base class and typed subclasses
- `output.ts` — chalk formatting helpers (printInfo, printError, etc.)
- `config.ts` — config loader with RepoId-to-path resolution

### Config Compositor (`src/config.ts`)

Root config reads `.grove.yaml` and validates via composed zod schemas from slice type files.

### CLI (`src/cli.ts`)

Commander-based program with subcommands delegating to slice `cli.ts` files. Exports `resolveCurrentRepo()` for commands that need a RepoId from cwd.

### Library API (`src/lib.ts`)

Public entry point for `@twiglylabs/grove`. Re-exports types and namespace modules from all slices.

## Development

```bash
npm test              # Run all tests (vitest)
npm run test:watch    # Watch mode
npm run build         # TypeScript build
npm run lint          # Type-check without emit
```

## Testing

- **Runner:** Vitest
- **Pattern:** Colocated tests (`*.test.ts` next to source)
- **Coverage:** v8 provider, configured in vitest.config.ts
- All tests must pass before committing

## Quality Gates

- `npm run build` succeeds (no type errors)
- `npm test` passes (all tests green)
- No `any` types without justification
- Branded types for domain identifiers (RepoId, WorkspaceId)

## Adding a New Slice

1. Create `src/<domain>/` directory
2. Add `types.ts` with zod schema fragment and exported interfaces
3. Register the schema in `src/config.ts` compositor
4. Add `api.ts` with public API functions
5. Add `cli.ts` with CLI command registration
6. Import and register commands in `src/cli.ts`
7. Re-export types and API namespace in `src/lib.ts`
