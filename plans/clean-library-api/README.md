---
title: Clean Library API
status: done
description: >-
  Refactor Grove API to return structured data with no stdout side effects,
  making it consumable as a JS library by Canopy
tags:
  - api
  - canopy
  - foundation
completed_at: '2026-02-21T02:41:20.502Z'
---

## Problem
Grove's API functions were designed CLI-first. Many functions in `api.ts` files call `printInfo()`, `printError()`, `printSuccess()` from `shared/output.ts` directly, mixing business logic with presentation. Some call `process.exit()`. This makes them unusable as a library — Canopy (an Electron app) needs to import Grove as `@twiglylabs/grove` and get structured return values, not stdout noise.

Every downstream plan depends on this being clean.
## Approach
Audit every `api.ts` across all slices. Refactor each function to:

1. **Return structured data** — results, errors, status objects instead of printing
2. **Throw typed errors** — use `GroveError` subclasses (already exist in `shared/errors.ts`) instead of `printError` + `process.exit`
3. **No chalk, no stdout** — zero imports from `shared/output.ts` in any `api.ts`

The CLI layer (`cli.ts` files) becomes the only place that formats output. Each `cli.ts` calls the API, then formats the result for the terminal.

This is a mechanical refactor — the logic doesn't change, only where formatting happens.

## Steps
1. Audit all `api.ts` files for `printInfo`/`printError`/`printSuccess`/`process.exit` calls
2. Define return types for each API function (e.g. `UpResult`, `StatusResult`)
3. Refactor `environment/api.ts` — largest surface area, most stdout usage
4. Refactor `workspace/api.ts` — second largest
5. Refactor remaining slices (repo, testing, logs, shell, simulator)
6. Move all formatting into `cli.ts` files
7. Verify `src/lib.ts` re-exports are clean — no transitive stdout dependencies
8. Add a lint rule or test that `api.ts` files don't import from `shared/output.ts`
