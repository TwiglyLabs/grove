## From plans

- **foundation** — directory layout (`src/repo/` exists), shared identity types (`src/shared/identity.ts`), shared errors (`src/shared/errors.ts`), commander CLI skeleton (`src/cli.ts`)

## From existing code

- `src/repo/state.ts` — current registry state management (file I/O, locking)
- `src/repo/list.ts` — current list logic
- `src/repo/types.ts` — current repo types
- `src/api/repo.ts` — current public API wrapper
- `src/api/types.ts` — `RepoEntry`, `RepoListEntry` type definitions
- `src/commands/repo.ts` — current CLI command with arg parsing
- `src/commands/repo.test.ts` — existing CLI tests
- `src/api/repo.test.ts` — existing API tests
