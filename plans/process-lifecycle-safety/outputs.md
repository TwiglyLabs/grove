
## Public API
`src/environment/api.ts` / supervisor internals export:
- Hardened `spawn(cmd, args, options)` — includes PID validation, FD cleanup on exit, and process-name check before signaling
- Awaitable `supervisor.stop(): Promise<void>` — resolves only after the supervised process has fully exited
- Signal handlers registered for `SIGINT` / `SIGTERM` — trigger graceful supervisor stop before process exit

## Types
`src/environment/types.ts` exports (additions):
- `SpawnOptions` — extended options including `pidGuard: boolean` and `fdCleanup: boolean` flags
- `SupervisorHandle` — `{ pid: number, stop(): Promise<void> }` returned by supervisor start

## Fixes delivered
- `down()` / supervisor race condition eliminated: `down()` awaits `supervisor.stop()` before returning
- Supervisor leak prevention: orphaned supervisor processes are detected and killed on startup if a stale PID file exists
- PID validation: before sending signals, process name is confirmed to match expected binary (prevents signaling recycled PIDs)
- FD cleanup: all file descriptors opened by spawned processes are closed on exit to prevent handle leaks

## Pattern established
Awaitable process lifecycle: downstream plan (controller-robustness) can rely on `supervisor.stop()` resolving before attempting state writes or rollbacks, eliminating TOCTOU races between process state and filesystem state.
