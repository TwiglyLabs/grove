## Steps
### Consolidate types

1. Create `src/request/types.ts` — move `RequestOptions`, `RequestResult` from `src/api/types.ts`
2. Run tests

### Extract business logic

3. Create `src/request/trellis.ts` — extract trellis convention logic from `src/commands/request.ts`: `.trellis` config parsing, plan directory resolution, plan file scaffolding, frontmatter generation, duplicate detection
4. Create `src/request/api.ts` — public API: `create(target, planName, opts)`. Compose trellis logic with repo resolution from repo slice
5. Run tests

### Create CLI subcommand

6. Create `src/request/cli.ts` — commander `Command` for `grove request <target> <plan>` with `--body`, `--description`, `--json` options. Move output formatting from `src/commands/request.ts`
7. Register in `src/cli.ts`
8. Move `src/commands/request.test.ts` → `src/request/request.test.ts` (the 31KB test suite)
9. Run tests

### Wire and cleanup

10. Update `src/index.ts` to re-export `import * as request from './request/api.js'`
11. Remove `src/api/request.ts`, `src/commands/request.ts`, `src/commands/request.test.ts`, request types from `src/api/types.ts`
12. Run full test suite — all must pass
13. Build and verify no type errors

## Testing
- All 31KB of existing request tests pass — now colocated in `src/request/`
- `grove request <target> <plan> --body "..."` works via commander
- Library consumers can `import { request } from 'grove'` and call `request.create()`
- Trellis convention logic (config parsing, plan scaffolding, frontmatter) works correctly when extracted
- Build succeeds with no type errors

## Done-when
- `src/request/` contains types.ts, trellis.ts, api.ts, cli.ts, and colocated tests
- `src/api/request.ts`, `src/commands/request.ts`, `src/commands/request.test.ts` are deleted
- Request types removed from `src/api/types.ts`
- All tests pass, build succeeds
