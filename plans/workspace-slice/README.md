---
title: 'Workspace Slice: Multi-Repo Lifecycle'
status: not_started
depends_on:
  - repo-slice
description: >-
  Migrate workspace lifecycle (create, sync, close, status) into self-contained
  vertical slice
tags:
  - slice
not_started_at: '2026-02-20T05:15:41.699Z'
---

## Problem

Workspace management is currently the largest domain in grove. It's spread across `src/workspace/` (7 files — create, sync, close, git, preflight, state, status), `src/api/workspace.ts` (API wrapper), `src/commands/workspace.ts` (14KB CLI command), and types scattered in `src/api/types.ts`. The workspace domain has complex git operations, state management, and preflight checks that all need to be colocated.

## Approach
**Consolidate into `src/workspace/`.** The slice gets a deeper internal structure because of its size:

- `src/workspace/types.ts` — all workspace types (CreateOptions, CreateResult, SyncResult, CloseResult, WorkspaceListEntry, WorkspaceEvents, etc.)
- `src/workspace/state.ts` — workspace state file I/O (the `~/.grove/workspaces/` directory)
- `src/workspace/git.ts` — git operations (worktree create/delete, branch management, merge)
- `src/workspace/preflight.ts` — pre-operation validation (dirty check, branch exists, etc.)
- `src/workspace/create.ts` — workspace creation logic
- `src/workspace/sync.ts` — workspace sync logic
- `src/workspace/close.ts` — workspace close logic (merge/discard modes)
- `src/workspace/status.ts` — workspace status queries
- `src/workspace/sanitize.ts` — branch name sanitization (from `src/sanitize.ts`)
- `src/workspace/api.ts` — public API surface: `create()`, `list()`, `getStatus()`, `sync()`, `close()`
- `src/workspace/cli.ts` — commander subcommand (`grove workspace create|list|status|sync|close`)
- `src/workspace/*.test.ts` — colocated tests

**Event callbacks.** `WorkspaceEvents` callback interface (from `src/api/events.ts`) moves into `src/workspace/types.ts`. This interface (`onProgress`, `onConflict`, `onError`) is workspace-specific and belongs in the slice.

**Branch sanitization.** `src/sanitize.ts` provides `sanitizeBranchName()` used during workspace creation. Move to `src/workspace/sanitize.ts` since it's only used by this domain.

**Depends on repo slice** for `RepoId` lookups and repo path resolution.

**Delete old locations.** Remove `src/api/workspace.ts`, `src/commands/workspace.ts`, `src/sanitize.ts`, workspace types from `src/api/types.ts`, `WorkspaceEvents` from `src/api/events.ts`.
