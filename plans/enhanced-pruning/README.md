---
title: Enhanced Pruning
status: not_started
description: >-
  Extend grove prune to clean orphaned worktrees, stale state files, dangling
  port allocations, and stopped processes
depends_on:
  - clean-library-api
tags:
  - reliability
  - canopy
not_started_at: '2026-02-21T02:02:30.133Z'
---

## Problem
Current `grove prune` only cleans orphaned k8s namespaces. When a Claude instance crashes or Canopy dies, you can be left with orphaned worktrees, stale state files, allocated port ranges that will never be released, and stopped frontend processes. With many parallel environments, orphan buildup becomes a real resource problem.
## Approach
Extend `prune()` to do a full-stack cleanup:

1. **Orphaned namespaces** (existing) — namespace exists but no state file references it
2. **Orphaned worktrees** — worktree directory exists but no workspace state references it
3. **Stale state files** — state file exists but worktree directory is gone
4. **Dangling port allocations** — ports allocated in state but no process listening
5. **Stopped processes** — PIDs recorded in state but process is dead

Return a structured report of what was cleaned. Support a `dryRun` param (and `--dry-run` CLI flag) to preview what would be cleaned.

**Cross-slice boundary:** This plan touches both `environment/` (namespaces, ports, processes, state files) and `workspace/` (worktrees, workspace state). Rather than moving prune to shared, the approach is:
- `environment/prune.ts` owns the orchestration and environment-level cleanup (namespaces, ports, processes, state files)
- `workspace/api.ts` exposes a `findOrphanedWorktrees()` helper that environment prune calls
- This keeps slice ownership clear while allowing composition

**Lock safety:** Port and state file cleanup must acquire `proper-lockfile` locks before modifying state, same as the existing read/write paths in `environment/state.ts`.
## Steps
Order matters — clean dependents before dependencies:

1. Implement stopped process detection — check PID liveness for all recorded processes in state files. **Clean these first** since port checks depend on process state.
2. Implement dangling port allocation detection — after dead processes are identified, check if ports are still bound. Respect `proper-lockfile` when modifying state.
3. Implement stale state file detection — for each `.grove/*.json` state file, verify the worktree directory still exists. **Clean state files before worktrees** to avoid dangling references.
4. Implement orphaned worktree detection — add `findOrphanedWorktrees()` to `workspace/api.ts`. Cross-reference `~/.grove/workspaces/*.json` with actual worktree directories.
5. Compose all checks into unified `prune()` that runs in order: processes → ports → state files → worktrees → namespaces
6. Add `dryRun` parameter — when true, return the report without executing any cleanup
7. Update `PruneResult` type to include per-category results (not just namespace deletions)
8. Tests: create orphaned state fixtures for each category, verify detection and cleanup
