# Close Merge Recovery: Prevent Failed State via Pre-check + Sync-on-Failed

Last updated: 2026-02-14

## Problem

When `grove workspace close --merge` fails because the fast-forward merge can't complete (upstream diverged), the workspace lands in `"failed"` status with no recovery path except `close --discard`. The dashboard (dotfiles repo) now shows separate Merge/Delete buttons and a Sync button for failed workspaces, but grove needs corresponding changes to support recovery.

Two issues:
1. `closeMerge` sets status to `"closing"` before attempting the FF merge. If FF fails, it sets `"failed"` — but it could have auto-synced first.
2. `syncWorkspace` rejects non-active workspaces, so a failed workspace can't be synced without manual state file editing.

## Key Assumption: Git Ref Sharing Across Worktrees

Git worktrees share the same object database and ref namespace as the main repository. When `syncWorkspace` merges upstream into a worktree (advancing the workspace branch ref, e.g. `feature-auth`), the source repo sees the updated ref immediately — no fetch or extra checkout is needed. This means `canFFMerge` called from the source repo will reflect the post-sync state.

## Changes

### 1. Add `canFFMerge` helper to `src/workspace/git.ts`

**After `mergeFFOnly`**

Pre-check whether a fast-forward merge is possible without actually performing it. Uses `git merge-base --is-ancestor` to check if the parent branch tip is an ancestor of the workspace branch tip.

```typescript
export function canFFMerge(source: string, parentBranch: string, workspaceBranch: string): boolean {
  // Verify both refs exist — avoids masking bad-ref errors (exit 128) as "can't FF"
  if (!gitNoThrow(`rev-parse --verify ${parentBranch}`, source).ok) {
    throw new Error(`Branch '${parentBranch}' not found in ${source}`);
  }
  if (!gitNoThrow(`rev-parse --verify ${workspaceBranch}`, source).ok) {
    throw new Error(`Branch '${workspaceBranch}' not found in ${source}`);
  }
  // FF is possible when parent branch tip is ancestor of workspace branch tip.
  // merge-base --is-ancestor works on refs directly — no checkout needed.
  // Exit code 0 = is ancestor (FF possible), exit code 1 = not ancestor.
  return gitNoThrow(`merge-base --is-ancestor ${parentBranch} ${workspaceBranch}`, source).ok;
}
```

Note: `gitNoThrow` already exists at the top of the file. The ref-existence checks above ensure that a non-zero exit code from `merge-base` genuinely means "not an ancestor" rather than "bad ref."

**Tests** in `src/workspace/git.test.ts`:
- `canFFMerge` returns true when parent is ancestor of workspace branch
- `canFFMerge` returns false when branches have diverged
- `canFFMerge` throws when parent branch ref does not exist
- `canFFMerge` throws when workspace branch ref does not exist

---

### 2. Restructure `closeMerge` to pre-check FF in `src/workspace/close.ts`

**Current flow:**
```
status check → dirty check → sync check → set 'closing' → for each repo: checkout + mergeFFOnly → if fail: set 'failed'
```

**New flow:**
```
status check → dirty check → sync check → save source branches → FF pre-check all repos → if any fail: restore branches, auto-sync, re-check ALL → if still fail: restore branches, throw (stay 'active') → set 'closing' → close loop
```

Concrete changes to `closeMerge()`:

**a)** Import `getCurrentBranch` from `./git.js` (already exported).

**b)** Import `canFFMerge` from `./git.js`.

**c)** Import `syncWorkspace` and `ConflictError` from `./sync.js`.

**d)** After the sync check and before dry-run handling, insert FF pre-check:

```typescript
  // Pre-check: can all repos fast-forward?
  if (!dryRun) {
    // Save source repo branches so we can restore if pre-check fails.
    // The close loop needs source repos on parentBranch, so we only
    // restore on failure — on success we leave them on parentBranch.
    const savedBranches: Array<{ source: string; branch: string }> = [];
    for (const repo of state.repos) {
      savedBranches.push({ source: repo.source, branch: getCurrentBranch(repo.source) });
    }

    const restoreBranches = () => {
      for (const { source, branch } of savedBranches) {
        try { checkout(source, branch); } catch {}
      }
    };

    // Check if any repo can't fast-forward
    let needsSync = false;
    for (const repo of state.repos) {
      checkout(repo.source, repo.parentBranch);
      if (!canFFMerge(repo.source, repo.parentBranch, state.branch)) {
        needsSync = true;
        break; // At least one needs sync — sync handles all repos together
      }
    }

    if (needsSync) {
      // Restore branches before sync — sync operates on worktrees, not source repos
      restoreBranches();

      try {
        await syncWorkspace(state.branch);
      } catch (e) {
        // Don't restore here — restoreBranches() already ran above
        if (e instanceof ConflictError) {
          throw new Error(
            `Cannot merge: conflicts in '${e.conflicted}'. ` +
            `Resolve conflicts, commit, then run 'grove workspace sync ${state.branch}' to complete syncing.`,
          );
        }
        throw e;
      }

      // Re-check ALL repos after sync. Git worktrees share refs, so the
      // source repo sees the workspace branch advanced by sync immediately.
      for (const repo of state.repos) {
        checkout(repo.source, repo.parentBranch);
        if (!canFFMerge(repo.source, repo.parentBranch, state.branch)) {
          restoreBranches();
          throw new Error(
            `Still cannot fast-forward '${repo.name}' after sync. Resolve manually.`,
          );
        }
      }
    }
    // On success, source repos are on parentBranch — the close loop expects this
  }
```

**e)** Keep the existing `'failed'` status + throw in the close loop as a safety net for unexpected failures (e.g. race condition where someone pushes to the parent branch between pre-check and merge). Note: if this safety net fires, the workspace is partially closed (some repos already merged) — the only recovery is `close --discard`.

**Tests** in `src/workspace/close.test.ts`:
- Close --merge with diverged upstream auto-syncs and succeeds (mock canFFMerge to return false then true)
- Close --merge with diverged upstream + conflict throws descriptive error mentioning sync, stays active
- Close --merge with diverged upstream + sync succeeds but still can't FF for a specific repo throws error naming that repo, stays active
- Close --merge dry-run skips pre-check (existing dry-run tests still pass)
- Close --merge pre-check failure restores source repos to their original branches

---

### 3. Allow sync on failed workspaces in `src/workspace/sync.ts`

**In `syncWorkspace`** — change the status check (currently rejects anything except `'active'`):

```typescript
  if (state.status !== 'active' && state.status !== 'failed') {
    throw new Error(`Workspace '${state.id}' is in '${state.status}' state, expected 'active' or 'failed'`);
  }

  // If failed, reset to active before proceeding
  if (state.status === 'failed') {
    state.status = 'active';
    state.updatedAt = new Date().toISOString();
    await writeWorkspaceState(state);
  }
```

This makes `grove workspace sync` the natural recovery path for failed workspaces — maps directly to the dashboard's Sync button. No separate `recover` command needed (see Design Decision below).

**Tests** in `src/workspace/sync.test.ts`:
- Sync on failed workspace resets to active and syncs normally
- Sync on creating/closing workspace still throws

---

## Design Decision: No Separate `recover` Command

An earlier draft included a `grove workspace recover <branch>` command that reset `failed → active` without syncing. This was removed because:

1. **Redundant** — `grove workspace sync` now accepts failed workspaces and resets status as part of its flow.
2. **Weak use case** — recovering without syncing leaves the workspace in the same state that caused the failure; `close --merge` will fail again.
3. **Partial close is unrecoverable anyway** — if the safety net in the close loop fires (some repos already merged), only `close --discard` works. Resetting to `active` would be misleading.
4. **Dashboard alignment** — the dashboard has Sync and Delete buttons for failed workspaces, not a Recover button.

The recovery flows are:
- **Pre-check catches divergence** → auto-sync → close succeeds (user sees nothing)
- **Pre-check catches divergence + conflicts** → user resolves conflicts → `grove workspace sync` → `grove workspace close --merge`
- **Safety-net failure (partial close)** → `grove workspace close --discard` (only option)
- **Dashboard** → Sync button calls `grove workspace sync` (resets failed → active) → Merge button calls `grove workspace close --merge`

---

## File Map

| File | Change | Description |
|------|--------|-------------|
| `src/workspace/git.ts` | ADD function | `canFFMerge` helper with ref validation + `merge-base --is-ancestor` |
| `src/workspace/close.ts` | MODIFY | Pre-check FF with branch save/restore, auto-sync on divergence |
| `src/workspace/sync.ts` | MODIFY | Accept failed workspaces, reset to active before syncing |
| `src/workspace/git.test.ts` | ADD tests | canFFMerge tests (success, diverged, bad refs) |
| `src/workspace/close.test.ts` | ADD tests | Pre-check, auto-sync, branch restore tests |
| `src/workspace/sync.test.ts` | ADD tests | Sync-on-failed tests |

## Implementation Order

1. **git.ts** — add `canFFMerge` with ref validation (no dependencies)
2. **sync.ts** — allow failed status (needed by close.ts auto-sync)
3. **close.ts** — restructure with pre-check + branch save/restore (depends on 1 and 2)

## Verification

```bash
npm test           # All unit tests pass
npm run test:e2e   # E2E tests pass (existing + new)
npm run lint       # No lint errors
```

Manual: create a workspace, advance main past it, run `grove workspace close --merge` — should auto-sync and succeed (or give clear conflict error), never land in failed state. Verify source repos are on their original branches after a pre-check failure.
