## From plans
- **repo-slice** — `repo.get(id)` and `repo.findByPath()` for resolving target and source repos
## From existing code
- `src/api/request.ts` — **primary source**: already-extracted API with `createRequest(RepoId, planName, options)`, typed errors, trellis parsing, worktree creation (207 lines). This is the code that moves to `src/request/api.ts`.
- `src/commands/request.ts` — CLI command with duplicated logic (317 lines). The arg parsing and output formatting move to `src/request/cli.ts`; the business logic is discarded in favor of the API version.
- `src/commands/request.test.ts` — comprehensive CLI test suite (729 lines, 40+ tests) — moves to `src/request/cli.test.ts` with import path update
- `src/api/types.ts` — `RequestOptions`, `RequestResult` definitions (lines 95-109) — move to `src/request/types.ts`
- `src/api/index.ts` — re-exports `request` module (line 85, 92) — update import path
- `src/cli.ts` — registers `requestCommand` (line 29, 94-100) — update import path
