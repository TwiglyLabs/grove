## From plans

- **workspace-slice** — `src/workspace/api.ts` public API, workspace types, CLI subcommand
- **satellite-slices** — `src/testing/api.ts`, `src/shell/api.ts`, `src/logs/api.ts`, `src/simulator/api.ts` public APIs, types, config schemas, CLI subcommands
- **request-slice** — `src/request/api.ts` public API, types, CLI subcommand

All slice migrations must be complete before cleanup can remove the old `src/api/`, `src/commands/`, and orphaned root files.

## From existing code

- `src/api/index.ts` — current public API barrel file (to be replaced)
- `src/api/types.ts` — current shared types (to be deleted, now owned by slices)
- `src/commands/` — all current CLI commands (to be deleted, now in slice cli.ts files)
- `src/types.ts` — root types file (to be deleted)
- `src/sanitize.ts` — utility absorbed into slices
- `package.json` — exports field pointing at old `./dist/api/index.js`
