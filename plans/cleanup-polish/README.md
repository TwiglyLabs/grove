---
title: 'Cleanup: Remove Old Structure, Update Exports and Docs'
status: done
depends_on:
  - workspace-slice
  - satellite-slices
  - request-slice
description: >-
  Remove old api/ directory, clean up root src/, update package.json exports,
  README, and CLAUDE.md
tags:
  - cleanup
not_started_at: '2026-02-20T05:15:43.425Z'
completed_at: '2026-02-21T01:29:05.005Z'
---

## Problem

After all slices are migrated, the old `src/api/` directory, `src/commands/` directory, and orphaned root-level files will still exist. The package.json exports still point to `./dist/api/index.js`. The README describes the old architecture. The CLAUDE.md needs a freshness update reflecting the completed restructure.

## Approach
**Delete old directories.** Remove `src/api/` entirely — all its functionality now lives in the slices. Remove `src/commands/` entirely. Remove orphaned root files: `src/types.ts`, `src/sanitize.ts`, `src/timing.ts`, `src/template.ts`, and any others that were absorbed into slices. Verify `src/api/events.ts` is empty or deleted (all event interfaces distributed to slices).

**Update `src/index.ts`.** The public API entry point re-exports from slices:
```ts
export * as repo from './repo/api.js'
export * as workspace from './workspace/api.js'
export * as environment from './environment/api.js'
export * as testing from './testing/api.js'
export * as logs from './logs/api.js'
export * as shell from './shell/api.js'
export * as simulator from './simulator/api.js'
export * as request from './request/api.js'
```
Plus shared types and errors from `src/shared/`.

**Update `package.json` exports.** Point main/types at the new `src/index.ts` output. Verify canopy's `file:../grove` dependency still resolves correctly.

**Update README.** Rewrite to reflect the vertical slice architecture, current command set, and library API.

**CLAUDE.md freshness pass.** Update freshness date, verify all conventions documented match the actual code.

**Verify canopy integration.** Build grove, then verify canopy's typecheck passes against the new exports — no broken imports.
