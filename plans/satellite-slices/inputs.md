## From plans

- **environment-slice** — `readState(config)` for accessing environment state (ports, URLs, namespace). Environment config schemas for resolving service/frontend configuration.

## From existing code

- `src/testing/` — test runner, parsers, history, types (6 files)
- `src/simulator/` — simulator management (2 files)
- `src/api/testing.ts`, `src/api/shell.ts`, `src/api/logs.ts`, `src/api/simulator.ts` — current API wrappers
- `src/api/types.ts` — `TestRunOptions`, `LogEntry`, `ShellCommand`, `SimulatorInfo` definitions
- `src/commands/test.ts`, `src/commands/shell.ts`, `src/commands/logs.ts` — current CLI commands
- `src/config.ts` — testing, simulator, utilities (shell targets, reload targets) zod schemas
- `src/types.ts` — `TestPlatform`, `TestOptions`, `TestResult` types
