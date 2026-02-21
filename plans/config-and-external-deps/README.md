---
title: Config Validation & External Dependencies
status: done
description: >-
  Fix config validation gaps, external tool timeouts, GenericDevServer startup
  detection and command parsing
tags:
  - reliability
  - environment
  - 'epic:reliability-hardening'
type: bugfix
not_started_at: '2026-02-21T20:29:11.746Z'
completed_at: '2026-02-21T20:47:35.167Z'
---

## Problem
Config validation and external tool integration have six gaps that produce confusing errors or hangs.

1. **External tool calls hang indefinitely** — `preflight.ts:11` (`execSync` with no timeout) runs `docker info`, `kubectl version`, `helm version`. `state.ts:25` runs `git branch --show-current`. `config.ts:124` runs `git rev-parse --show-toplevel`. None have timeouts. `grove up` hangs at startup if Docker is mid-boot, kubectl is connecting to a slow cluster, or git waits on a credential helper.

2. **`remotePort` has no range validation** — `environment/config.ts:54` accepts `z.number()` with no constraints. `remotePort: 0` or `remotePort: 99999` passes Zod, then `kubectl port-forward svc/foo 10000:0` fails with a kubectl error instead of a clear Grove validation error.

3. **`hostIp` is a free-form string** — `environment/config.ts:55` accepts any string. A typo like `hostIp: "127.0.01"` passes validation, then kubectl either ignores it or fails with an opaque error.

4. **Config validation error loses Zod detail** — `ConfigValidationError` (errors.ts:41-43) message says `"Config validation failed: N issue(s)"` but discards the `ZodError.issues` array with field paths and messages. User has no idea which fields are wrong.

5. **GenericDevServer has no startup failure detection** — `GenericDevServer.ts:43-55` returns immediately after `child.unref()` with no check that the process is alive. If the command is wrong, the child exits instantly but `start()` returns a dead PID.

6. **GenericDevServer command parsing broken for quoted args** — `GenericDevServer.ts:41` splits on spaces with `.split(' ')`. Commands with quoted arguments containing spaces break.
## Approach
**Overlap note:** Chunk 4 (GenericDevServer hardening) touches the same file as `process-lifecycle-safety` chunk 1 (FD cleanup, pid guard). Coordinate implementation order: implement process-lifecycle-safety chunk 1 first (FD cleanup + pid guard), then config-and-external-deps chunk 4 (startup liveness + command parsing) on top. Or implement on the same branch to avoid merge conflicts.

1. **Add timeouts** — `timeout: 5000` for `docker info`, `kubectl version`, `helm version`, `kind version`, `k3d version`. `timeout: 3000` for `git branch --show-current` and `git rev-parse --show-toplevel`.

2. **Tighten Zod schemas** — `remotePort: z.number().int().min(1).max(65535)`. `hostIp`: use `z.string().ip({ version: 'v4' })` (Zod v3.22+) or a regex validator.

3. **Format Zod errors** — In `ConfigValidationError` constructor, format `issues` into readable field-path messages.

4. **GenericDevServer startup check** — After spawn, sleep briefly (200ms), then `process.kill(child.pid, 0)` to verify alive. If dead, throw a typed error. If health config exists, do a health check.

5. **Shell-aware command parsing** — Use `shell: true` in spawn options so the OS handles quoting, or split into separate `command` and `args` config fields.
## Steps
### Chunk 1: External tool timeouts

- [ ] `preflight.ts:checkCommand` — add `timeout: 5000` to `execSync` options
- [ ] `state.ts:getCurrentBranch` — add `timeout: 3000` to `execSync`
- [ ] `config.ts:getRepoRoot` — add `timeout: 3000` to `execSync`
- [ ] Tests: verify checkCommand with slow command times out and returns failed check (not hang)

### Chunk 2: Schema validation tightening

- [ ] `environment/config.ts` `PortForwardSchema` — change `remotePort: z.number()` to `z.number().int().min(1).max(65535)`
- [ ] `environment/config.ts` `PortForwardSchema` — change `hostIp: z.string()` to `z.string().ip({ version: 'v4' })` or `.regex(/^\d{1,3}(\.\d{1,3}){3}$/)`
- [ ] Tests: remotePort=0 fails validation, remotePort=99999 fails, remotePort=8080 passes
- [ ] Tests: hostIp='locahost' fails, hostIp='127.0.0.1' passes

### Chunk 3: Config error messaging

- [ ] `ConfigValidationError` constructor — format `issues` array: `issues.map(i => \`${i.path.join('.')}: ${i.message}\`).join(', ')`
- [ ] Update the `super()` call to include formatted issues in the message
- [ ] Tests: ConfigValidationError message includes field paths

### Chunk 4: GenericDevServer hardening

- [ ] After `child.unref()`, add 200ms sleep then `process.kill(child.pid, 0)` liveness check
- [ ] If liveness fails, throw a new typed error (or reuse `BuildFailedError` / add `FrontendStartFailedError`)
- [ ] Replace `.split(' ')` with `spawn(command, { shell: true })` pattern — pass the full command as a single string to the shell
- [ ] Create `GenericDevServer.test.ts` with tests:
  - Successful start returns valid ProcessInfo
  - Failed command (bad path) throws error
  - stop() escalates SIGTERM→SIGKILL
  - isHealthy() with no health config returns true
  - isHealthy() with health config calls checkHealth
