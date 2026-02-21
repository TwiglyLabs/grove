## Steps
### Move types

1. Create `src/request/types.ts` — move `RequestOptions`, `RequestResult` from `src/api/types.ts`
2. Update `src/api/request.ts` import to use `../request/types.js` temporarily (keeps things building during migration)
3. Run build

### Extract trellis utilities

4. Create `src/request/trellis.ts` — extract from `src/api/request.ts`: `parseTrellisConfig()`, `toTitle()`, `detectSourceRepoName()`
5. Create `src/request/trellis.test.ts` — unit tests:
   - `parseTrellisConfig()`: valid config, missing file, malformed content, no plans_dir key, empty plans_dir value
   - `toTitle()`: single segment (`a` → `A`), multi-segment (`my-plan` → `My Plan`), with numbers (`fix-api-v2` → `Fix Api V2`)
6. Run tests

### Move API

7. Move `src/api/request.ts` → `src/request/api.ts` — update imports to use local `./trellis.js` and `./types.js`
8. Create `src/request/api.test.ts` — API-level tests for `createRequest()`:
   - Valid request with RepoId → returns `RequestResult` with correct fields
   - Unknown RepoId → throws `RepoNotFoundError`
   - Invalid plan name → throws with kebab-case message
   - Empty body → throws
   - Self-request (source === target) → throws
   - Duplicate plan file in plans_dir/ → throws
   - Duplicate plan file in plans_dir/active/ → throws
   - Branch already exists → throws `BranchExistsError`
   - Detached HEAD → throws
   - With explicit `sourceRepo` option → uses it
   - Without `sourceRepo` → auto-detects from cwd
   - With `description` option → included in frontmatter
   - Without `description` → empty string in frontmatter
   - Correct worktree path, branch name, commit message in result
9. Run tests

### Rewrite CLI

10. Create `src/request/cli.ts` — `requestCommand(args: string[])` following repo-slice pattern:
    - Manual arg parsing (positional args + flags)
    - Supports `--body`, `--body-file` (mutually exclusive), `--description`, `--json`, `--help`
    - Delegates to `createRequest()` from `./api.js` — no inlined business logic
    - CLI handles: arg parsing, `--body-file` reading, RepoId resolution (lookup by name), output formatting (text vs JSON)
    - Error handling: catch errors, format via `printError()`/`jsonError()`
11. Move `src/commands/request.test.ts` → `src/request/cli.test.ts` — update import from `'./request.js'` to `'./cli.js'`
12. Run tests

### Wire and cleanup

13. Update `src/api/index.ts` — change `import * as request from './request.js'` to `import * as request from '../request/api.js'`
14. Update `src/api/types.ts` — remove `RequestOptions` and `RequestResult` definitions, add re-export: `export type { RequestOptions, RequestResult } from '../request/types.js'`
15. Update `src/cli.ts` — change `import { requestCommand } from './commands/request.js'` to `import { requestCommand } from './request/cli.js'`
16. Delete `src/api/request.ts`, `src/commands/request.ts`, `src/commands/request.test.ts`
17. Delete `src/request/.gitkeep`
18. Run full test suite — all must pass
19. Run build — no type errors
## Testing
Three test files, each with a distinct purpose:

**`src/request/trellis.test.ts`** (new) — Unit tests for pure/near-pure extracted utilities:
- `parseTrellisConfig()`: valid config returns plans_dir value; missing file returns `'plans'`; malformed content returns `'plans'`; no plans_dir key returns `'plans'`; empty plans_dir value returns `'plans'`
- `toTitle()`: `'a'` → `'A'`; `'my-plan'` → `'My Plan'`; `'fix-api-v2'` → `'Fix Api V2'`

**`src/request/api.test.ts`** (new) — Integration tests for the public API:
- Creates real git repos in temp dir (same pattern as existing tests)
- Tests `createRequest(RepoId, planName, options)` directly
- Verifies return type (`RequestResult`), error types (`RepoNotFoundError`, `BranchExistsError`), and side effects (worktree created, plan file written with correct frontmatter, commit made, workspace state written)
- Covers all validation paths: invalid plan name, empty body, self-request, duplicates, branch conflict, detached HEAD
- Covers optional fields: `sourceRepo`, `description`

**`src/request/cli.test.ts`** (moved from `src/commands/request.test.ts`) — CLI integration tests:
- Import path updated from `'./request.js'` to `'./cli.js'`
- All existing 40+ tests preserved — covers arg parsing, `--body-file`, JSON output, text output, usage/help
- These now test the thin CLI wrapper that delegates to the API
## Done-when
- `src/request/` contains: `types.ts`, `trellis.ts`, `api.ts`, `cli.ts`, `trellis.test.ts`, `api.test.ts`, `cli.test.ts`
- `src/api/request.ts`, `src/commands/request.ts`, `src/commands/request.test.ts` are deleted
- `src/request/.gitkeep` is deleted
- Request types removed from `src/api/types.ts` (replaced with re-exports from `../request/types.js`)
- `src/api/index.ts` imports request from `'../request/api.js'`
- `src/cli.ts` imports requestCommand from `'./request/cli.js'`
- **New API tests** pass — `createRequest()` has dedicated coverage
- **New trellis unit tests** pass — `parseTrellisConfig()` and `toTitle()` have dedicated coverage
- **Existing CLI tests** pass at new location with updated imports
- `npm run build` succeeds (no type errors)
- `npm test` passes (all tests green)
