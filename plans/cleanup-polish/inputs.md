## From plans

- **workspace-slice** — `src/workspace/api.ts` public API, workspace types, CLI subcommand
- **satellite-slices** — `src/testing/api.ts`, `src/shell/api.ts`, `src/logs/api.ts`, `src/simulator/api.ts` public APIs, types, config schemas, CLI subcommands
- **request-slice** — `src/request/api.ts` public API, types, CLI subcommand

All slice migrations must be complete before cleanup can remove the old `src/api/`, `src/commands/`, and orphaned root files.

## From existing code
- `src/api/index.ts` — current public API barrel file (to be replaced)
- `src/api/types.ts` — current shared types (to be deleted, now owned by slices)
- `src/api/events.ts` — event interfaces (to be deleted, distributed to environment/workspace/testing slices)
- `src/api/config.ts` — config API loader (to be deleted, moved to `src/shared/config.ts` in foundation)
- `src/commands/` — all current CLI commands (to be deleted, now in slice cli.ts files)
- `src/types.ts` — root types file (to be deleted, moved to testing slice)
- `src/sanitize.ts` — branch sanitization (to be deleted, moved to workspace slice)
- `src/template.ts` — env var template resolution (to be deleted, moved to environment slice)
- `package.json` — exports field pointing at old `./dist/api/index.js`
