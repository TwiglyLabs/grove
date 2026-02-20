## From plans

- **environment-slice** — `readState(config)` for accessing environment state (ports, URLs, namespace). Environment config schemas for resolving service/frontend configuration.

## From existing code
- `src/testing/` — test runner, parsers, history, types (6 files: `test-runner.ts`, `test-helpers.ts`, `result-parsers.ts`, `result-archive.ts`, `result-parsers.test.ts`, `test-runner.test.ts`)
- `src/simulator/` — simulator management (`simulator.ts`, `simulator.test.ts`)
- `src/api/testing.ts`, `src/api/shell.ts`, `src/api/logs.ts`, `src/api/simulator.ts` — current API wrappers
- `src/api/testing.test.ts`, `src/api/shell.test.ts`, `src/api/logs.test.ts`, `src/api/simulator.test.ts` — current API tests
- `src/api/events.ts` — `TestEvents` callback interface (`onProgress`, `onTestComplete`, `onError`)
- `src/api/types.ts` — `TestRunOptions`, `LogEntry`, `ShellCommand`, `SimulatorInfo` definitions
- `src/commands/test.ts`, `src/commands/shell.ts`, `src/commands/logs.ts` — current CLI commands
- `src/commands/shell.test.ts` — existing shell command tests
- `src/config.ts` — testing, simulator, utilities (shell targets, reload targets) zod schemas
- `src/types.ts` — `TestPlatform`, `TestOptions`, `TestResult` types
