## From plans

- **repo-slice** — `repo.get(id)` and `repo.findByPath()` for resolving target and source repos

## From existing code

- `src/commands/request.ts` — main business logic (10KB): trellis config parsing, plan directory resolution, worktree creation, frontmatter generation, duplicate detection
- `src/commands/request.test.ts` — comprehensive test suite (31KB)
- `src/api/request.ts` — current public API wrapper
- `src/api/types.ts` — `RequestOptions`, `RequestResult` definitions
