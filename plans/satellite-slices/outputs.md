## Public APIs

- `src/testing/api.ts` — `run(repoId, opts): Promise<TestResult>`
- `src/shell/api.ts` — `open(repoId, service): ShellCommand`
- `src/logs/api.ts` — `stream(repoId, service, opts): LogEntry[]`
- `src/simulator/api.ts` — `ensure(repoId)`, `status(repoId)`, `reset(repoId)`

## Config schemas

- `src/testing/config.ts` — testing and observability zod schemas
- `src/shell/config.ts` — shell targets schema (from current utilities section)
- `src/simulator/config.ts` — simulator zod schema

## CLI subcommands

- `grove test` — registered from `src/testing/cli.ts`
- `grove shell` — registered from `src/shell/cli.ts`
- `grove logs` — registered from `src/logs/cli.ts`

## Types

Each slice exports its own types from `types.ts` — no more shared `src/types.ts` or `src/api/types.ts`.
