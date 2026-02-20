---
title: 'Workspace Slice: Multi-Repo Lifecycle'
status: draft
depends_on:
  - repo-slice
description: >-
  Migrate workspace lifecycle (create, sync, close, status) into
  self-contained vertical slice
tags:
  - slice
---

## Problem

Workspace management is currently the largest domain in grove. It's spread across `src/workspace/` (7 files — create, sync, close, git, preflight, state, status), `src/api/workspace.ts` (API wrapper), `src/commands/workspace.ts` (14KB CLI command), and types scattered in `src/api/types.ts`. The workspace domain has complex git operations, state management, and preflight checks that all need to be colocated.

## Approach

**Consolidate into `src/workspace/`.** The slice gets a deeper internal structure because of its size:

- `src/workspace/types.ts` — all workspace types (CreateOptions, CreateResult, SyncResult, CloseResult, WorkspaceListEntry, etc.)
- `src/workspace/state.ts` — workspace state file I/O (the `~/.grove/workspaces/` directory)
- `src/workspace/git.ts` — git operations (worktree create/delete, branch management, merge)
- `src/workspace/preflight.ts` — pre-operation validation (dirty check, branch exists, etc.)
- `src/workspace/create.ts` — workspace creation logic
- `src/workspace/sync.ts` — workspace sync logic
- `src/workspace/close.ts` — workspace close logic (merge/discard modes)
- `src/workspace/status.ts` — workspace status queries
- `src/workspace/api.ts` — public API surface: `create()`, `list()`, `getStatus()`, `sync()`, `close()`
- `src/workspace/cli.ts` — commander subcommand (`grove workspace create|list|status|sync|close`)
- `src/workspace/*.test.ts` — colocated tests

**Depends on repo slice** for `RepoId` lookups and repo path resolution.

**Delete old locations.** Remove `src/api/workspace.ts`, `src/commands/workspace.ts`, workspace types from `src/api/types.ts`.
