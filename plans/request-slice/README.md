---
title: 'Request Slice: Cross-Repo Plan Requests'
status: done
depends_on:
  - repo-slice
description: Migrate cross-repo request logic into self-contained vertical slice
tags:
  - slice
not_started_at: '2026-02-20T05:15:42.610Z'
started_at: '2026-02-20T23:59:29.586Z'
completed_at: '2026-02-21T00:14:25.630Z'
---

## Problem
The cross-repo plan request feature is split across three locations:

- `src/api/request.ts` — Already-extracted API with `createRequest(RepoId, planName, options)`, typed errors, branded RepoId support (207 lines)
- `src/commands/request.ts` — CLI command with duplicated business logic inlined, uses string repo names instead of RepoId (317 lines)
- `src/api/types.ts` — Defines `RequestOptions`, `RequestResult` inline with other domain types

The API extraction is already done in `src/api/request.ts` but it lives in the wrong directory. The CLI command duplicates all the logic rather than delegating to the API. Neither has dedicated tests — the existing 31KB test suite only covers the CLI layer.
## Approach
**Move and consolidate into `src/request/`.** The slice owns:

- `src/request/types.ts` — `RequestOptions`, `RequestResult` (moved from `src/api/types.ts`)
- `src/request/trellis.ts` — trellis convention logic: `.trellis` config parsing, plan directory resolution, title generation
- `src/request/api.ts` — public API: `createRequest(target, planName, opts)` (moved from `src/api/request.ts`, not re-extracted from the CLI)
- `src/request/cli.ts` — `requestCommand(args: string[])` function (matching repo-slice pattern: manual arg parsing, not a commander Command object)
- `src/request/api.test.ts` — **new** API-level tests for `createRequest()`
- `src/request/trellis.test.ts` — **new** unit tests for extracted trellis utilities
- `src/request/cli.test.ts` — existing CLI tests (moved from `src/commands/request.test.ts`, import paths updated)

**Depends on repo slice** for target repo resolution (`repo.get(id)`, `repo.findByPath()`).

**Key insight:** `src/api/request.ts` already contains the extracted API logic with RepoId support. This is primarily a **move** (api/request.ts → request/api.ts), not an extraction. The CLI (`src/commands/request.ts`) gets rewritten to delegate to the API instead of duplicating logic.

**CLI pattern:** Follows the repo-slice pattern — `requestCommand(args: string[])` with manual arg parsing, registered in `src/cli.ts` via `allowUnknownOption().action(async (_options, cmd) => requestCommand(cmd.args))`. Supports `--body`, `--body-file`, `--description`, `--json`, `--help`.

**Delete old locations.** Remove `src/api/request.ts`, `src/commands/request.ts`, `src/commands/request.test.ts`, request types from `src/api/types.ts`. Update `src/api/index.ts` to re-import from new location.
