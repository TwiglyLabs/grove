---
title: 'Satellite Slices: Testing, Shell, Logs, Simulator'
status: draft
depends_on:
  - environment-slice
description: >-
  Migrate testing, shell, logs, and simulator domains into their own vertical
  slices
tags:
  - slice
---

## Problem

Four smaller domains — testing, shell, logs, simulator — are scattered across `src/testing/`, `src/simulator/`, flat root files, `src/api/`, and `src/commands/`. They all depend on environment state (ports, namespace, URLs) but are otherwise independent of each other. They need to follow the established vertical slice pattern.

## Approach

These four are small enough to migrate in a single plan. Each follows the same pattern established by repo-slice.

**Testing slice (`src/testing/`):**
- `types.ts` — `TestPlatform`, `TestOptions`, `TestResult`, `TestRunOptions`, `FailureDetail`
- `config.ts` — owns the testing + observability zod schemas
- `runner.ts` — test execution logic (mobile/webapp/api runners)
- `parser.ts` — result parsing
- `history.ts` — test history archiving
- `api.ts` — public API: `run(repoId, opts)`
- `cli.ts` — commander subcommand: `grove test`
- Colocated tests

**Shell slice (`src/shell/`):**
- `types.ts` — `ShellCommand`
- `config.ts` — owns the shell targets zod schema (from utilities)
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

**All four slices** import `readState()` from the environment slice to access ports, URLs, and namespace. They import their config sections from the root compositor.

**Delete old locations.** Remove `src/testing/`, `src/simulator/`, `src/api/{testing,shell,logs,simulator}.ts`, `src/commands/{test,shell,logs}.ts`, and relevant types from `src/api/types.ts`.
