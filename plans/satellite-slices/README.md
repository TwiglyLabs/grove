---
title: 'Satellite Slices: Testing, Shell, Logs, Simulator'
status: not_started
depends_on:
  - environment-slice
description: >-
  Migrate testing, shell, logs, and simulator domains into their own vertical
  slices
tags:
  - slice
not_started_at: '2026-02-20T05:15:42.997Z'
---

## Problem

Four smaller domains — testing, shell, logs, simulator — are scattered across `src/testing/`, `src/simulator/`, flat root files, `src/api/`, and `src/commands/`. They all depend on environment state (ports, namespace, URLs) but are otherwise independent of each other. They need to follow the established vertical slice pattern.

## Approach
These four are small enough to migrate in a single plan. Each follows the same pattern established by repo-slice.

**Testing slice (`src/testing/`):**
- `types.ts` — `TestPlatform`, `TestOptions`, `TestResult`, `TestRunOptions`, `FailureDetail`, `TestEvents`
- `config.ts` — owns the testing + observability zod schemas
- `runner.ts` — test execution logic (mobile/webapp/api runners)
- `parser.ts` — result parsing
- `history.ts` — test history archiving
- `api.ts` — public API: `run(repoId, opts)`
- `cli.ts` — commander subcommand: `grove test`
- Colocated tests

**Shell slice (`src/shell/`):**
- `types.ts` — `ShellCommand`
- `config.ts` — owns the shell targets zod schema (from utilities `shellTargets`)
- `api.ts` — public API: `open(repoId, service)`
- `cli.ts` — commander subcommand: `grove shell`
- Colocated tests

**Logs slice (`src/logs/`):**
- `types.ts` — `LogEntry`
- `api.ts` — public API: `stream(repoId, service, opts)`
- `cli.ts` — commander subcommand: `grove logs`
- Colocated tests

**Simulator slice (`src/simulator/`):**
- `types.ts` — `SimulatorInfo`
- `config.ts` — owns the simulator zod schema
- `api.ts` — public API: `ensure(repoId)`, `status(repoId)`, `reset(repoId)`
- Colocated tests
- Note: simulator is API-only — no CLI subcommand (no `src/commands/simulator.ts` exists today)

**Event callbacks.** `TestEvents` callback interface (from `src/api/events.ts`) moves into `src/testing/types.ts`. This interface (`onProgress`, `onTestComplete`, `onError`) is testing-specific.

**Utilities schema split.** The current `UtilitiesSchema` contains `shellTargets` and `reloadTargets`. These split: `shellTargets` goes to `src/shell/config.ts`, `reloadTargets` goes to `src/environment/config.ts` (in environment-slice plan). The `UtilitiesSchema` wrapper is removed.

**All four slices** import `readState()` from the environment slice to access ports, URLs, and namespace. They import their config sections from the root compositor.

**Delete old locations.** Remove `src/testing/`, `src/simulator/`, `src/api/{testing,shell,logs,simulator}.ts`, `src/commands/{test,shell,logs}.ts`, relevant types from `src/api/types.ts`, and `TestEvents` from `src/api/events.ts`.
