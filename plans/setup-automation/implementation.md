
## Steps
### Schema Definitions
1. Add `SetupCommandSchema` to `workspace/types.ts` with fields: `command` (string), `cwd` (optional string), `env` (optional record).
2. Add `HooksSchema` to `workspace/types.ts` with a `postCreate` field accepting an array of `SetupCommandSchema`.
3. Add `setup` (array of `SetupCommandSchema`) and `hooks` (`HooksSchema`) fields to `WorkspaceConfigSchema`.
4. Register the updated `WorkspaceConfigSchema` fragment in `src/config.ts`.

### Implement runSetupCommands()
1. Implement `runSetupCommands(commands: SetupCommand[], cwd: string): Promise<SetupResult[]>` in `workspace/api.ts`.
2. Execute commands sequentially, capturing stdout, stderr, exit code, and duration for each.
3. On failure, stop execution and mark the result with the failing command details.

### Integrate into workspace.create()
1. After worktree creation succeeds, call `runSetupCommands()` with the `setup` array from config.
2. If any setup command fails, mark the workspace state as `failed` and include which command failed.
3. Return `SetupResult[]` as part of the `CreateResult` type.

### Lifecycle Hook Execution
1. Implement `runHook(hookName: string, config: WorkspaceConfig, cwd: string)` in `workspace/api.ts`.
2. After `workspace.create()` completes successfully, fire the `postCreate` hook.
3. Wire the hook call at the end of `workspace.create()`.

### Partial Failure Handling
1. Ensure the workspace state is written as `failed` (not left in `creating`) when setup fails.
2. Include the index, command string, and output of the failing command in the error result.

### Tests
1. Write unit tests for `runSetupCommands()` with mocked `child_process.spawn` (or `execa`).
2. Test sequential execution order.
3. Test that a failing command stops execution and returns structured failure info.
4. Test that `workspace.create()` marks state as `failed` on setup failure.
5. Test that the `postCreate` hook fires after successful creation.

## Testing
- Setup commands run sequentially after worktree creation; order is verified.
- Failed commands include stdout, stderr, exit code, duration, and command string in the result.
- Partial setup failure marks the workspace state as `failed` and halts remaining commands.
- The `postCreate` hook fires after a fully successful `workspace.create()`.
- `child_process` is mocked in all unit tests; no real processes are spawned.
- `npm run build` succeeds with no type errors.
- `npm test` passes with all tests green.

## Done-when
- The `setup` config section is valid in `.grove.yaml` and parsed correctly.
- `workspace.create()` runs setup commands automatically after worktree creation.
- `SetupResult[]` is returned with `command`, `exitCode`, `stdout`, `stderr`, and `durationMs` for each command.
- Partial failure correctly marks workspace state as `failed` and records which command failed.
- The `postCreate` hook fires at the correct lifecycle point.
