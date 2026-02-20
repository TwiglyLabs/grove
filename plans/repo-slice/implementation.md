## Steps
### Consolidate types

1. Update `src/repo/types.ts`: make `id` field required in `RepoEntry` zod schema (remove `.optional()`). Add `RepoListEntry` type (moved from `src/api/types.ts`)
2. Run tests to verify schema change doesn't break existing registry reads (entries without id should fail validation — check how `state.ts` handles this)

### Consolidate API

3. Create `src/repo/api.ts` with public API functions: `add(path)`, `remove(id)`, `list()`, `findByPath(path)`, `get(id)`. Pull logic from `src/api/repo.ts` and any inline logic in `src/commands/repo.ts`
4. Move/merge `src/api/repo.test.ts` tests into `src/repo/api.test.ts`
5. Run tests

### Create CLI subcommand

6. Create `src/repo/cli.ts` — commander `Command` for `grove repo` with subcommands `add`, `remove`, `list`. Move arg parsing and output formatting from `src/commands/repo.ts`
7. Register in `src/cli.ts`
8. Move `src/commands/repo.test.ts` tests into `src/repo/cli.test.ts`
9. Run tests

### Wire into root

10. Update `src/index.ts` to re-export `import * as repo from './repo/api.js'`
11. Run tests

### Delete old locations

12. Remove `src/api/repo.ts`, `src/api/repo.test.ts`
13. Remove `src/commands/repo.ts`, `src/commands/repo.test.ts`
14. Remove repo-related types (`RepoEntry`, `RepoListEntry`) from `src/api/types.ts`
15. Run full test suite — all must pass
16. Build and verify no type errors

## Testing
- All existing repo tests pass (state, list, API, CLI) — now colocated in `src/repo/`
- `grove repo add .` registers a repo
- `grove repo list` shows registered repos
- `grove repo remove <id>` removes a repo
- Library consumers can `import { repo } from 'grove'` and call `repo.list()`, `repo.add()`, etc.
- Build succeeds with no type errors

## Done-when
- `src/repo/` contains types.ts, state.ts, api.ts, cli.ts, and colocated tests
- `src/api/repo.ts` and `src/commands/repo.ts` are deleted
- Repo types removed from `src/api/types.ts`
- Root `src/index.ts` re-exports repo slice
- `src/cli.ts` registers the repo commander subcommand
- All tests pass, build succeeds
