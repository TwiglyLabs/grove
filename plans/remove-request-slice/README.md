---
title: Remove Request Slice
status: not_started
description: >-
  Remove src/request/ slice superseded by trellis — delete code, config schema,
  CLI commands, and lib re-exports
tags:
  - cleanup
not_started_at: '2026-02-21T02:02:28.876Z'
---

## Problem
The `src/request/` slice creates cross-repo plan requests by making worktrees with plan files. This functionality is now covered by trellis. The slice is dead code that adds maintenance burden and confusion.
## Approach
Straight deletion. Remove the slice and all references to it.

## Steps
1. Delete `src/request/` directory (api.ts, cli.ts, types.ts, trellis.ts, and all test files)
2. Remove `requestCommand` import and registration from `src/cli.ts` (both the import line and the config-free commands section)
3. Remove `request` namespace import and re-export from `src/lib.ts`
4. Remove any request-related type exports from `src/lib.ts`
5. Verify `src/config.ts` has no request schema references (it shouldn't — request operates independently)
6. Run `npm run build` — verify no type errors
7. Run `npm test` — verify all tests pass (request tests will be gone, nothing else should break)
