## Steps
### Testing slice

1. Create `src/testing/types.ts` — move `TestPlatform`, `TestOptions`, `TestResult`, `FailureDetail` from `src/types.ts`. Move `TestRunOptions` from `src/api/types.ts`. Move `TestEvents` from `src/api/events.ts`
2. Create `src/testing/config.ts` — move testing + observability zod schemas from root `config.ts`
3. Rename/reorganize: `test-runner.ts` → `runner.ts`, `result-parsers.ts` → `parser.ts`, `result-archive.ts` → `history.ts`, keep `test-helpers.ts`
4. Create `src/testing/api.ts` — public API: `run(repoId, opts)`. Pull from `src/api/testing.ts`
5. Create `src/testing/cli.ts` — commander subcommand: `grove test`. Move from `src/commands/test.ts`
6. Move/merge all test files. Register CLI in `src/cli.ts`
7. Run tests

### Shell slice

8. Create `src/shell/types.ts` — move `ShellCommand` from `src/api/types.ts`
9. Create `src/shell/config.ts` — move `ShellTargetSchema` and `shellTargets` from `UtilitiesSchema` in root `config.ts`
10. Create `src/shell/api.ts` — public API: `open(repoId, service)`. Pull from `src/api/shell.ts`
11. Create `src/shell/cli.ts` — commander subcommand: `grove shell`. Move from `src/commands/shell.ts`
12. Move/merge tests. Register CLI in `src/cli.ts`
13. Run tests

### Logs slice

14. Create `src/logs/types.ts` — move `LogEntry` from `src/api/types.ts`
15. Create `src/logs/api.ts` — public API: `stream(repoId, service, opts)`. Pull from `src/api/logs.ts`
16. Create `src/logs/cli.ts` — commander subcommand: `grove logs`. Move from `src/commands/logs.ts`
17. Move/merge tests. Register CLI in `src/cli.ts`
18. Run tests

### Simulator slice

19. Create `src/simulator/types.ts` — move `SimulatorInfo` from `src/api/types.ts`
20. Create `src/simulator/config.ts` — move simulator zod schema from root `config.ts`
21. Reorganize `src/simulator/simulator.ts` → `src/simulator/api.ts` — public API: `ensure()`, `status()`, `reset()`. Pull from `src/api/simulator.ts`
22. Move/merge tests (no CLI — simulator is API-only)
23. Run tests

### Wire and cleanup

24. Update `src/index.ts` to re-export: `testing`, `shell`, `logs`, `simulator` from their slice api.ts
25. Update root `src/config.ts` to import schema fragments from testing, shell, simulator slices
26. Remove old: `src/api/{testing,shell,logs,simulator}.ts` and tests, `src/commands/{test,shell,logs}.ts` and tests, testing/shell/simulator types from `src/api/types.ts`, `TestEvents` from `src/api/events.ts`, `src/types.ts`
27. Run full test suite — all must pass
28. Build and verify no type errors

## Testing
- All existing testing/shell/logs/simulator tests pass — now colocated in their slice directories
- `grove test`, `grove shell`, `grove logs` work via commander
- Simulator API works without CLI (API-only)
- Library consumers can import testing, shell, logs, simulator from grove
- Config schemas compose correctly from slice fragments (testing, shell, simulator)
- TestEvents callbacks fire correctly during test runs
- Build succeeds with no type errors

## Done-when
- `src/testing/` contains types.ts, config.ts, runner.ts, parser.ts, history.ts, test-helpers.ts, api.ts, cli.ts, and colocated tests
- `src/shell/` contains types.ts, config.ts, api.ts, cli.ts, and colocated tests
- `src/logs/` contains types.ts, api.ts, cli.ts, and colocated tests
- `src/simulator/` contains types.ts, config.ts, api.ts, and colocated tests (no CLI)
- Old API wrappers and commands deleted
- `src/types.ts` deleted (types distributed to slices)
- TestEvents removed from `src/api/events.ts`
- UtilitiesSchema split: shellTargets → shell slice, reloadTargets → environment slice
- Root config imports schema fragments from all satellite slices
- All tests pass, build succeeds
