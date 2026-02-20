---
title: 'Request Slice: Cross-Repo Plan Requests'
status: not_started
depends_on:
  - repo-slice
description: Migrate cross-repo request logic into self-contained vertical slice
tags:
  - slice
not_started_at: '2026-02-20T05:15:42.610Z'
---

## Problem

The cross-repo plan request feature is split between `src/api/request.ts` (API wrapper) and `src/commands/request.ts` (a large 10KB CLI command that contains most of the business logic — trellis config parsing, plan directory resolution, git worktree creation, frontmatter generation, duplicate detection). The command file is doing too much, and the logic isn't accessible to library consumers.

## Approach

**Consolidate into `src/request/`.** The slice owns:

- `src/request/types.ts` — `RequestOptions`, `RequestResult`
- `src/request/trellis.ts` — trellis convention logic: `.trellis` config parsing, plan directory resolution, plan file scaffolding, frontmatter generation
- `src/request/api.ts` — public API: `create(target, planName, opts)` — the full workflow (resolve target repo, create worktree, write plan file, commit)
- `src/request/cli.ts` — commander subcommand: `grove request <target> <plan> --body ... [--description ...] [--json]`
- `src/request/*.test.ts` — colocated tests (the current 31KB test file covers this well)

**Depends on repo slice** for target repo resolution (`repo.get(id)`, `repo.findByPath()`).

**Business logic moves out of CLI.** The current `src/commands/request.ts` has the real logic inlined. Extract it to `api.ts` and `trellis.ts` so library consumers (like canopy) can create cross-repo requests programmatically.

**Delete old locations.** Remove `src/api/request.ts`, `src/commands/request.ts`, request types from `src/api/types.ts`.
