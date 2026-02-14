# Grove Workspace Management: Implementation Tasks

Last updated: 2026-02-13

## Overview

Implemented in 4 phases. Each phase builds on the previous and can be tested independently. Grove already has the project structure, build tooling, and patterns to follow (zod schemas, state management, command routing).

## File Map

| File | Status | Description |
|------|--------|-------------|
| `src/config.ts` | MODIFY | Add WorkspaceConfigSchema to GroveConfigSchema |
| `src/workspace/types.ts` | NEW | Workspace state types and zod schemas |
| `src/workspace/state.ts` | NEW | Read/write/list workspace state in ~/.grove/workspaces/ |
| `src/workspace/git.ts` | NEW | Git worktree operations (create, remove, status) |
| `src/workspace/create.ts` | NEW | Create workspace command logic |
| `src/workspace/sync.ts` | NEW | Sync workspace command logic |
| `src/workspace/close.ts` | NEW | Close workspace command logic (merge + discard) |
| `src/workspace/status.ts` | NEW | Status + list command logic |
| `src/commands/workspace.ts` | NEW | Command router for `grove workspace <subcommand>` |
| `src/index.ts` | MODIFY | Add workspace command to main router |
| `src/output.ts` | MODIFY | Add JSON envelope helpers |

---

## Phase 1: Foundation (types, state, config)

**Goal:** Config parsing and state management work. No git operations yet.

**Success Criteria:**
- `.grove.yaml` with `workspace` section parses correctly
- Workspace state files can be created, read, listed, deleted in `~/.grove/workspaces/`
- JSON envelope output works

### Task 1.1: Extend config schema

- [ ] Add `WorkspaceRepoSchema` and `WorkspaceConfigSchema` to `src/config.ts`
- [ ] Make workspace optional in `GroveConfigSchema`
- [ ] `loadConfig` should not require `.grove.yaml` to exist for workspace commands (simple workspaces have no config)
- [ ] Add `loadWorkspaceConfig()` that returns workspace config or null

### Task 1.2: Create workspace types and state

- [ ] Create `src/workspace/types.ts` with all zod schemas (WorkspaceState, SyncState, etc.)
- [ ] Create `src/workspace/state.ts` with read/write/list/delete operations
- [ ] State directory: `~/.grove/workspaces/`
- [ ] Use `proper-lockfile` for concurrent access (same pattern as existing `state.ts`)

### Task 1.3: Add JSON output helpers

- [ ] Add `jsonSuccess(data)` and `jsonError(message, data?)` to `src/output.ts`
- [ ] Non-zero exit code on error

### Task 1.4: Tests for phase 1

- [ ] Config parsing with and without workspace section
- [ ] State CRUD operations
- [ ] JSON output formatting

**Exit criteria:** `npm test` passes, state files round-trip correctly.

---

## Phase 2: Create & List

**Goal:** Can create grouped and simple workspaces and list them.

**Success Criteria:**
- `grove workspace create feature-x` creates worktrees for all repos
- Physical layout mirrors source structure
- `grove workspace list` shows all workspaces
- `grove workspace status feature-x` shows per-repo details

### Task 2.1: Git worktree operations

- [ ] Create `src/workspace/git.ts`
- [ ] `createWorktree(source, branch, targetPath)` — wraps `git worktree add -b`
- [ ] `removeWorktree(source, worktreePath)` — wraps `git worktree remove`
- [ ] `deleteBranch(source, branch, force?)` — wraps `git branch -d/-D`
- [ ] `getRepoStatus(worktreePath)` — dirty count, commit count ahead of parent
- [ ] `getCurrentBranch(repoPath)` — get current branch name
- [ ] `isGitRepo(path)` — check if path has .git

### Task 2.2: Create command

- [ ] Create `src/workspace/create.ts`
- [ ] Detect grouped vs simple from config
- [ ] Validate child repos exist and are git repos
- [ ] Create parent worktree, then children nested inside
- [ ] Write state file throughout (creating → active)
- [ ] Rollback on failure (remove any created worktrees, set failed)

### Task 2.3: List and status commands

- [ ] Create `src/workspace/status.ts`
- [ ] `list` reads all state files from `~/.grove/workspaces/`
- [ ] `status` reads one state file + gathers git status per repo
- [ ] Auto-detect workspace from cwd (walk up to find worktree root, match to state)

### Task 2.4: Command routing

- [ ] Create `src/commands/workspace.ts` — parse subcommand + flags
- [ ] Wire into `src/index.ts` main switch
- [ ] Support `--json` flag on all subcommands
- [ ] Support `--from <path>` on create

### Task 2.5: Tests for phase 2

- [ ] Create command with mock git operations
- [ ] Create rollback on failure
- [ ] List with multiple workspaces
- [ ] Status output structure

**Exit criteria:** Can create a workspace, list it, see status. Manual verification with real repos.

---

## Phase 3: Sync

**Goal:** Can sync workspace with upstream and handle conflicts.

**Success Criteria:**
- `grove workspace sync feature-x` fetches and merges main into each repo
- Conflicts stop the sync, report files, and are resumable
- Re-running sync after conflict resolution continues

### Task 3.1: Sync command

- [ ] Create `src/workspace/sync.ts`
- [ ] Initialize sync progress in state (all pending)
- [ ] For each pending repo: fetch, merge
- [ ] Detect conflicts (`git diff --name-only --diff-filter=U`)
- [ ] On conflict: update state, exit with structured error
- [ ] On resume: detect resolved conflicts (no merge in progress), mark synced, continue
- [ ] On all synced: clear sync state

### Task 3.2: Conflict detection helpers

- [ ] `isMergeInProgress(worktreePath)` — check for `.git/MERGE_HEAD` or equivalent in worktree
- [ ] `getConflictedFiles(worktreePath)` — list files with conflicts
- [ ] `hasDirtyWorkingTree(worktreePath)` — uncommitted changes check

### Task 3.3: Tests for phase 3

- [ ] Sync with no upstream changes (all synced immediately)
- [ ] Sync with clean merge
- [ ] Sync with conflicts (stops, reports)
- [ ] Resume after conflict resolution

**Exit criteria:** Full sync cycle works including conflict resolution flow.

---

## Phase 4: Close

**Goal:** Can merge-close and discard-close workspaces atomically.

**Success Criteria:**
- `grove workspace close feature-x --merge` does ff-only merge on all repos, cleans up
- `grove workspace close feature-x --discard` force-removes everything
- Dirty workspace blocks merge-close
- Un-synced workspace blocks merge-close

### Task 4.1: Close --merge command

- [ ] Create `src/workspace/close.ts`
- [ ] Pre-checks: no dirty repos, all synced
- [ ] Set status to closing
- [ ] Children first, then parent: checkout parentBranch, merge --ff-only, worktree remove, branch -d
- [ ] If ff-only fails on any repo: abort, suggest re-sync
- [ ] On success: delete state file
- [ ] On failure: set status failed, report which repo failed

### Task 4.2: Close --discard command

- [ ] Force remove all worktrees
- [ ] Force delete all branches
- [ ] Delete state file
- [ ] Should succeed even if some repos are in weird states

### Task 4.3: Failed state recovery

- [ ] `create` detects existing failed state → clean up and retry
- [ ] `close --discard` works on failed state → always succeeds

### Task 4.4: Tests for phase 4

- [ ] Merge-close happy path
- [ ] Merge-close blocked by dirty files
- [ ] Merge-close blocked by unsynced state
- [ ] Merge-close fails on ff-only (main moved)
- [ ] Discard-close happy path
- [ ] Discard-close from failed state
- [ ] Recovery from failed create

**Exit criteria:** Full lifecycle works: create → work → sync → close. Manual end-to-end test with acorn repos.
