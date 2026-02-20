---
title: 'Repo Slice: Registry Management'
status: done
depends_on:
  - foundation
description: >-
  Migrate repo registry into self-contained vertical slice with own types,
  state, API, CLI, and tests
tags:
  - slice
not_started_at: '2026-02-20T05:15:41.236Z'
completed_at: '2026-02-20T23:50:18.759Z'
---

## Problem

Repo registry logic is currently split across three locations: `src/repo/` (state management), `src/api/repo.ts` (public API wrapper), and `src/commands/repo.ts` (CLI command with arg parsing and output formatting). Types live in `src/api/types.ts` mixed with every other domain's types. This is the simplest domain (no config dependency), making it the ideal first slice to establish the vertical slice pattern.

## Approach
**Consolidate into `src/repo/`.** The slice directory owns everything:

- `src/repo/types.ts` — `RepoEntry` (zod schema + type), `RepoRegistry` (zod schema + type), `RepoListEntry`. Note: the existing `src/repo/types.ts` already has zod schemas for `RepoEntry` (with `id: z.string().optional()`) and `RepoRegistry`. These will be updated: `id` becomes required (assigned on add), and `RepoListEntry` is added (moved from `src/api/types.ts`)
- `src/repo/state.ts` — registry file I/O (`~/.grove/repos.json` read/write/lock)
- `src/repo/api.ts` — public API functions: `add(path)`, `remove(id)`, `list()`, `findByPath(path)`, `get(id)`
- `src/repo/cli.ts` — commander subcommand registration (`grove repo add|remove|list`)
- `src/repo/*.test.ts` — colocated tests for state and API

**Wire into root.** `src/index.ts` re-exports `import * as repo from './repo/api.js'`. `src/cli.ts` imports and registers the repo subcommand.

**Delete old locations.** Remove `src/api/repo.ts`, `src/commands/repo.ts`, repo-related types from `src/api/types.ts`, and the old `src/repo/` files.

**No behavior changes.** Public API stays `repo.list()`, `repo.add()`, etc. CLI stays `grove repo add|remove|list`. All existing tests pass, now colocated inside the slice.
