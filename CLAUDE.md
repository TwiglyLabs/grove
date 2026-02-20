# Grove

Config-driven local Kubernetes development tool. Manages development environments, multi-repo workspaces, testing, and service orchestration.

**Freshness:** 2026-02-20

## Architecture

Grove is migrating to a **vertical slice architecture**. Each domain (repo, workspace, environment, etc.) owns its schema, commands, API surface, and tests.

### Directory Structure

```
src/
  shared/           Cross-cutting infrastructure (identity, errors, output, config loader)
  api/              Public library API — re-exports from slices, domain modules
  commands/         CLI command implementations (delegated from cli.ts)
  repo/             Repo registry management
  workspace/        Multi-repo workspace operations
  environment/      (empty — pending migration)
  testing/          Test runner and result parsing
  simulator/        iOS simulator management
  shell/            (empty — pending migration)
  logs/             (empty — pending migration)
  request/          (empty — pending migration)
  config.ts         Root config parser — composes domain schema fragments
  cli.ts            Commander CLI skeleton — registers all commands
  index.ts          CLI entry point (parses args via commander)
```

### Shared Infrastructure (`src/shared/`)

- `identity.ts` — `RepoId`, `WorkspaceId` branded types
- `errors.ts` — `GroveError` base class and typed subclasses
- `output.ts` — chalk formatting helpers (printInfo, printError, etc.)
- `config.ts` — config loader with RepoId-to-path resolution

### Config Compositor (`src/config.ts`)

Root config reads `.grove.yaml` and validates via composed zod schemas. Each schema fragment is exported individually and annotated with which slice will own it. Slices will import their fragment during migration.

### CLI (`src/cli.ts`)

Commander-based program with subcommands delegating to `src/commands/`. Exports `resolveCurrentRepo()` for commands that need a RepoId from cwd.

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
2. Export a zod schema fragment for the domain's config section
3. Register the schema in `src/config.ts` compositor
4. Add command(s) in `src/commands/` or move existing ones
5. Register commands in `src/cli.ts`
6. Export public API types in `src/api/types.ts`
7. Wire up in `src/api/index.ts`
