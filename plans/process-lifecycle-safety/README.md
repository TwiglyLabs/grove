---
title: Process Lifecycle Safety
status: done
description: >-
  Fix child process spawning, killing, tracking, and cleanup — signal handling,
  supervisor shutdown races, FD leaks, PID validation
tags:
  - reliability
  - environment
  - 'epic:reliability-hardening'
type: bugfix
not_started_at: '2026-02-21T20:29:09.845Z'
started_at: '2026-02-21T21:11:53.420Z'
completed_at: '2026-02-21T21:17:08.911Z'
---

## Problem
Child process management has eight concrete bugs that cause orphaned processes, file descriptor leaks, and incorrect process identification in normal daily use.

1. **No signal handler** — `detached: true` + `child.unref()` in `PortForwardProcess.ts:44-49` means kubectl processes survive grove exit. No `SIGINT`/`SIGTERM` handler exists anywhere. Every Ctrl-C leaves orphans.

2. **Supervisor stop() is fire-and-forget** — `PortForwardSupervisor.stop()` (line 74) clears the interval but does not await an in-flight `checkAll()`. If `checkAll` is mid-recovery when `down()` calls `stop()`, `attemptRecovery()` can spawn a new kubectl process after shutdown.

3. **`down()` races with supervisor recovery** — `api.ts:142-167` calls `stop()` then iterates `state.processes`. A concurrent `attemptRecovery` writes new PIDs into `state.processes` that `down()`'s iteration has already passed.

4. **Multiple `up()` calls leak supervisors** — `activeSupervisor` (`api.ts:37`) is overwritten without stopping the previous one (`api.ts:111-113`). Each leaked supervisor fires `checkAll()` every 15s forever.

5. **FD leak in `PortForwardProcess.start()`** — Two `openSync` FDs (`PortForwardProcess.ts:30-31`) are never closed when `checkTcpReady` returns false and `PortForwardFailedError` is thrown (line 55). Accumulates under supervisor recovery retries until EMFILE.

6. **FD leak in `GenericDevServer.start()`** — Same pattern: `GenericDevServer.ts:37-38` opens FDs before spawn with no cleanup on spawn failure.

7. **`child.pid` can be `undefined`** — `PortForwardProcess.ts:54,59` and `GenericDevServer.ts:53` use `child.pid!`. If spawn fails to obtain a PID, `process.kill(undefined)` coerces to `process.kill(0)`, sending SIGTERM to the process group — potentially killing grove itself.

8. **PID reuse in `isProcessRunning`** — `api.ts:39-46` uses `process.kill(pid, 0)` which matches any process with that PID number, including unrelated ones after reboot. `down()` can SIGTERM a random system process.
## Approach
Fix process lifecycle from spawn to cleanup, working bottom-up:

**Overlap note:** Chunk 1 (spawn hardening) touches `GenericDevServer.ts`, which is also modified by `config-and-external-deps` chunk 4 (startup liveness + command parsing). Implement this plan's chunk 1 first (FD cleanup + pid guard), then config-and-external-deps chunk 4 on top. Or implement on the same branch.

1. **Harden spawn** — Guard `child.pid` immediately after `spawn()` in both `PortForwardProcess` and `GenericDevServer`. Wrap FD opens in try/finally to ensure `closeSync` on any failure path.

2. **Make supervisor stop awaitable** — Change `stop()` to `async stop()`: track the current `checkAll()` promise, await it, add `if (!this.running) return;` guard at top of `attemptRecovery()`. Update `SupervisorHandle` type accordingly.

3. **Fix down/supervisor race** — `down()` must await `activeSupervisor.stop()` before killing processes. Since `stop()` is now async and drains in-flight work, the race is eliminated.

4. **Prevent supervisor leaks on re-up** — Before assigning `activeSupervisor`, check and stop the old one.

5. **Add signal handler** — Register `process.on('SIGINT')` and `process.on('SIGTERM')` in the CLI entry point that calls `down()` for the current repo.

6. **Harden PID validation** — Add an optional process-name check: verify the PID's command line contains `kubectl` (via `ps -p <pid> -o comm=`) before treating it as a grove-managed process. Fall back to kill(pid, 0) if ps fails.
## Steps
### Chunk 1: Spawn hardening (PortForwardProcess + GenericDevServer)

- [ ] `PortForwardProcess.start()` — add `if (!child.pid)` guard after spawn, throw `PortForwardFailedError`
- [ ] `PortForwardProcess.start()` — wrap post-spawn logic in try/finally, call `closeSync(out)` and `closeSync(err)` in finally
- [ ] `GenericDevServer.start()` — add `if (!child.pid)` guard after spawn
- [ ] `GenericDevServer.start()` — wrap in try/finally for FD cleanup
- [ ] Tests: PortForwardProcess — spawn failure returns proper error, FDs not leaked
- [ ] Tests: GenericDevServer — spawn failure returns proper error, FDs not leaked (create `GenericDevServer.test.ts`)

### Chunk 2: Supervisor shutdown correctness

- [ ] Add `private currentCheck: Promise<...> | null` field to `PortForwardSupervisor`
- [ ] In `start()`, assign `this.currentCheck = this.checkAll().catch(...)` inside the interval callback
- [ ] Change `stop()` to `async stop(): Promise<void>` — set `this.running = false`, clear interval, then `await this.currentCheck`
- [ ] Add `if (!this.running) return false;` guard at top of `attemptRecovery()`
- [ ] Update `SupervisorHandle` interface: `stop(): void` → `stop(): Promise<void>`
- [ ] Update `api.ts:down()` to `await activeSupervisor.stop()`
- [ ] Update `api.ts:up()` — before assigning `activeSupervisor`, check and `await activeSupervisor.stop()`
- [ ] Tests: supervisor stop awaits in-flight checkAll
- [ ] Tests: attemptRecovery bails out when running=false
- [ ] Tests: down() with active supervisor stops it before killing processes
- [ ] Tests: double up() stops old supervisor

### Chunk 3: PID validation hardening

- [ ] Extract `isProcessRunning` into a shared utility (or keep in api.ts)
- [ ] Add optional process-name verification: `isGroveProcess(pid)` that checks `ps -p <pid> -o comm=` contains `kubectl` or the frontend command
- [ ] Use in `down()` and `status()` — skip/warn if PID belongs to a different process
- [ ] Tests: PID reuse scenario — pid exists but is not kubectl, isProcessRunning returns false

### Chunk 4: Signal handling

- [ ] In `src/environment/api.ts` (or a new `src/environment/signals.ts`), export `registerCleanupHandler(repo: RepoId)` and `unregisterCleanupHandler()`
- [ ] Implementation: on SIGINT/SIGTERM, call `down(repo)` then `process.exit()`
- [ ] Call `registerCleanupHandler` at end of `up()`
- [ ] Call `unregisterCleanupHandler` at start of `down()`
- [ ] Tests: verify handler is registered after up, removed after down
