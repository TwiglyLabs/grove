---
title: Error Infrastructure & API Surface
status: not_started
description: >-
  Fix error subclassing, missing lib.ts re-exports, supervisor off-by-one,
  untested error classes
tags:
  - reliability
  - api
  - 'epic:reliability-hardening'
type: bugfix
not_started_at: '2026-02-21T20:29:12.225Z'
---

## Problem
Four smaller issues in error infrastructure and the public API surface.

1. **`GroveError` prototype chain broken in compiled JS** — `errors.ts:8-16` extends `Error` but does not call `Object.setPrototypeOf(this, new.target.prototype)`. In ES5/ES2015 compilation targets, `error instanceof BuildFailedError` returns false. The check in `watcher.ts:135` silently fails, wrapping every `GroveError` in another `BuildFailedError`.

2. **`lib.ts` missing re-exports** — `EnvironmentState` and `ProcessInfo` (used as properties of `UpResult`, `DownResult`, etc.) are not exported from `lib.ts`. Library consumers cannot declare typed variables without importing from internal paths.

3. **Supervisor off-by-one** — `PortForwardSupervisor.ts:111` uses `failureCount > maxRecoveryAttempts` (strict greater-than). With `maxRecoveryAttempts: 3`, gave-up fires on the 4th failure, not the 3rd. One extra recovery attempt beyond what the option name implies.

4. **`PreflightFailedError` and `PortForwardFailedError` have no tests** — `errors.test.ts` covers every other error class but these two.
## Approach
Small, independent fixes:

1. **Fix prototype chain** — Add `Object.setPrototypeOf(this, new.target.prototype)` to `GroveError` constructor. All subclasses inherit the fix.

2. **Add re-exports** — Export `EnvironmentState`, `ProcessInfo`, and `WatcherOptions` from `lib.ts`.

3. **Fix off-by-one** — Change `>` to `>=` on line 111 of `PortForwardSupervisor.ts`.

4. **Add missing error tests** — Cover `PreflightFailedError` and `PortForwardFailedError` in `errors.test.ts`.

## Steps
### Chunk 1: Error prototype fix

- [ ] `GroveError` constructor — add `Object.setPrototypeOf(this, new.target.prototype)` as first line after `super(message)`
- [ ] Tests: `new BuildFailedError('svc') instanceof GroveError` returns true
- [ ] Tests: `new BuildFailedError('svc') instanceof BuildFailedError` returns true
- [ ] Tests: `new BuildFailedError('svc') instanceof Error` returns true

### Chunk 2: Missing re-exports

- [ ] `lib.ts` environment types block — add `EnvironmentState`, `ProcessInfo`
- [ ] `lib.ts` — add `export type { WatcherOptions } from './environment/watcher.js'`
- [ ] Verify: `import type { EnvironmentState, ProcessInfo, WatcherOptions } from '@twiglylabs/grove'` compiles

### Chunk 3: Supervisor off-by-one

- [ ] `PortForwardSupervisor.ts:111` — change `forward.failureCount > this.maxRecoveryAttempts` to `>=`
- [ ] Update existing tests that depend on the old behavior (check `PortForwardSupervisor.test.ts`)
- [ ] Tests: with maxRecoveryAttempts=2, gaveUp fires after exactly 2 failed recovery attempts

### Chunk 4: Missing error class tests

- [ ] `errors.test.ts` — add test for `PreflightFailedError`: verify `code`, `message`, `checks` property
- [ ] `errors.test.ts` — add test for `PortForwardFailedError`: verify `code`, `message`, `service`, `port` properties
