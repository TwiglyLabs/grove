## Public APIs
- `src/testing/api.ts` — `run(repoId, opts): Promise<TestResult>`
- `src/shell/api.ts` — `open(repoId, service): ShellCommand`
- `src/logs/api.ts` — `stream(repoId, service, opts): LogEntry[]`
- `src/simulator/api.ts` — `ensure(repoId)`, `status(repoId)`, `reset(repoId)` (API-only, no CLI subcommand)
## Config schemas

- `src/testing/config.ts` — testing and observability zod schemas
- `src/shell/config.ts` — shell targets schema (from current utilities section)
- `src/simulator/config.ts` — simulator zod schema

## CLI subcommands
- `grove test` — registered from `src/testing/cli.ts`
- `grove shell` — registered from `src/shell/cli.ts`
- `grove logs` — registered from `src/logs/cli.ts`
- Simulator has no CLI subcommand (API-only domain)
## Types
Each slice exports its own types from `types.ts` — no more shared `src/types.ts` or `src/api/types.ts`.

- `src/testing/types.ts` — `TestPlatform`, `TestOptions`, `TestResult`, `TestRunOptions`, `FailureDetail`, `TestEvents` (event interface moved from `src/api/events.ts`)
- `src/shell/types.ts` — `ShellCommand`
- `src/logs/types.ts` — `LogEntry`
- `src/simulator/types.ts` — `SimulatorInfo`
