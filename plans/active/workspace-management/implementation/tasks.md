# Grove Workspace Management: Implementation Tasks

Last updated: 2026-02-14

## Overview

Implemented in 5 phases. Each phase builds on the previous and can be tested independently. Grove already has the project structure, build tooling, and patterns to follow (zod schemas, state management, command routing).

## File Map

| File | Status | Description |
|------|--------|-------------|
| `src/config.ts` | DONE | Add WorkspaceConfigSchema, add `loadWorkspaceConfig()` |
| `src/workspace/types.ts` | DONE | Workspace state types and zod schemas |
| `src/workspace/state.ts` | DONE | Read/write/list workspace state (supports `GROVE_STATE_DIR`) |
| `src/workspace/git.ts` | DONE | Git worktree operations (create, remove, status) |
| `src/workspace/preflight.ts` | DONE | Preflight validation (branch consistency, existence checks) |
| `src/workspace/create.ts` | DONE | Create workspace command logic |
| `src/workspace/sync.ts` | DONE | Sync workspace command logic |
| `src/workspace/close.ts` | DONE | Close workspace command logic (merge + discard) |
| `src/workspace/status.ts` | DONE | Status + list command logic (with stale detection) |
| `src/commands/workspace.ts` | DONE | Command router with comprehensive help system |
| `src/index.ts` | DONE | Add workspace command to main router |
| `src/output.ts` | DONE | Add JSON envelope helpers |
| `test/e2e/workspace.e2e.test.ts` | DONE | End-to-end tests with real git repos |

---

## Phase 1: Foundation (types, state, config)

**Goal:** Config parsing and state management work. No git operations yet.

**Status: COMPLETE**

### Task 1.1: Extend config schema

- [x] Add `WorkspaceRepoSchema` and `WorkspaceConfigSchema` to `src/config.ts`
- [x] Make workspace optional in `GroveConfigSchema`
- [x] Add `loadWorkspaceConfig(repoRoot: string): WorkspaceConfig | null` — separate from `loadConfig()`, does NOT throw if `.grove.yaml` is missing or has no workspace section
- [x] Existing `loadConfig()` remains unchanged (still throws if config missing)

### Task 1.2: Create workspace types and state

- [x] Create `src/workspace/types.ts` with all zod schemas (WorkspaceState, SyncState, etc.)
- [x] Use `z.string().datetime()` for timestamp fields (createdAt, updatedAt, startedAt)
- [x] Create `src/workspace/state.ts` with read/write/list/delete operations
- [x] State directory: `~/.grove/workspaces/` (configurable via `GROVE_STATE_DIR`)
- [x] Use `proper-lockfile` for concurrent access (same pattern as existing `state.ts`)

### Task 1.3: Add JSON output helpers

- [x] Add `jsonSuccess(data)` and `jsonError(message, data?)` to `src/output.ts`
- [x] `jsonError` sets `process.exitCode = 1` (non-zero exit on error)

### Task 1.4: Tests for phase 1

- [x] Config parsing with and without workspace section
- [x] `loadWorkspaceConfig()` returns null when file missing
- [x] `loadWorkspaceConfig()` returns null when no workspace key
- [x] State CRUD operations
- [x] JSON output formatting
- [x] `GROVE_STATE_DIR` env var support

---

## Phase 2: Create (simple workspaces)

**Goal:** Can create and list simple (single-repo) workspaces.

**Status: COMPLETE**

### Task 2.1: Git worktree operations

- [x] Create `src/workspace/git.ts`
- [x] `createWorktree(source, branch, targetPath)` — wraps `git worktree add -b`
- [x] `removeWorktree(source, worktreePath, force?)` — wraps `git worktree remove`
- [x] `deleteBranch(source, branch, force?)` — wraps `git branch -d/-D`
- [x] `getRepoStatus(worktreePath, parentBranch)` — dirty count, commit count ahead of parent
- [x] `getCurrentBranch(repoPath)` — get current branch name
- [x] `isGitRepo(path)` — check if path has .git
- [x] `branchExists(source, branch)` — check if branch name is taken
- [x] `getWorktreeBasePath()` — returns `$GROVE_WORKTREE_DIR` or `~/worktrees/`

### Task 2.2: Preflight validation

- [x] Create `src/workspace/preflight.ts`
- [x] `preflightCreate(sources, branch)` — runs all checks, returns errors or validated data
- [x] Returns structured result: `{ ok: true, parentBranch, ... }` or `{ ok: false, errors: [...] }`

### Task 2.3: Create command (simple only)

- [x] Create `src/workspace/create.ts`
- [x] Simple workspace: single repo, no config needed
- [x] Run preflight checks before any mutations
- [x] Create worktree, write state (creating → active)
- [x] Rollback on post-preflight failure

### Task 2.4: List and status commands

- [x] Create `src/workspace/status.ts`
- [x] `list` reads all state files with stale workspace detection (`missing` flag)
- [x] `status` reads one state file + gathers git status per repo
- [x] Auto-detect workspace from cwd (proper path boundary matching)

### Task 2.5: Command routing

- [x] Create `src/commands/workspace.ts` — parse subcommand + flags
- [x] Parse `--json` flag once in router, pass as context to all handlers
- [x] Wire into `src/index.ts` main switch
- [x] Support `--from <path>` on create
- [x] `switch` subcommand prints workspace root path
- [x] `help` subcommand and `--help` per subcommand with agent-readable documentation

### Task 2.6: Tests for phase 2

- [x] Preflight: branch exists → error
- [x] Preflight: not a git repo → error
- [x] Create simple workspace with mock git operations
- [x] Create rollback on failure
- [x] List with multiple workspaces
- [x] Status output structure
- [x] `--json` flag produces envelope output
- [x] Switch subcommand tests (find by branch, by ID, JSON, error cases)
- [x] Help subcommand tests

---

## Phase 3: Create (grouped workspaces)

**Goal:** Extend create to handle multi-repo grouped workspaces.

**Status: COMPLETE**

### Task 3.1: Grouped create

- [x] Extend `src/workspace/create.ts` with grouped workspace path
- [x] Load workspace config via `loadWorkspaceConfig()`
- [x] Validate child repos exist at declared paths and are git repos
- [x] **Branch consistency check:** all repos must be on the same branch, error with details if not
- [x] Preflight: check branch doesn't exist in ANY repo before creating in any
- [x] Create parent worktree, then children nested inside
- [x] Rollback: if child N fails, remove children 0..N-1 and parent

### Task 3.2: Tests for phase 3

- [x] Grouped create with mock git operations
- [x] Branch consistency: all on main → ok
- [x] Branch consistency: mixed branches → error with details
- [x] Branch exists in one child but not others → error
- [x] Rollback on partial grouped create failure
- [x] Config with invalid child paths → error

---

## Phase 4: Sync & Close

**Goal:** Full lifecycle — sync with upstream and close (merge or discard).

**Status: COMPLETE**

### Task 4.1: Sync command

- [x] Create `src/workspace/sync.ts`
- [x] Initialize sync progress in state (all pending)
- [x] For each pending repo (parent first, then children): fetch, merge
- [x] Detect conflicts (`git diff --name-only --diff-filter=U`)
- [x] On conflict: update state, exit with structured error
- [x] On resume: check for merge-in-progress, uncommitted changes, or clean state
- [x] Warn if conflicts resolved but not committed (dirty tree + no MERGE_HEAD)
- [x] On all synced: clear sync state

### Task 4.2: Conflict detection helpers

- [x] Add to `src/workspace/git.ts`:
- [x] `isMergeInProgress(worktreePath)` — check for MERGE_HEAD in worktree's git dir
- [x] `getConflictedFiles(worktreePath)` — list files with conflicts
- [x] `hasDirtyWorkingTree(worktreePath)` — uncommitted changes check

### Task 4.3: Close --merge command

- [x] Create `src/workspace/close.ts`
- [x] Pre-checks: no dirty repos, all synced
- [x] Set status to closing
- [x] Children first, then parent: checkout parentBranch, merge --ff-only, worktree remove, branch -d
- [x] If ff-only fails on any repo: abort, suggest re-sync
- [x] On success: delete state file
- [x] On failure: set status failed, report which repo failed

### Task 4.4: Close --discard command

- [x] Best-effort cleanup — errors collected, not fatal
- [x] Abort any active merge before removing worktree
- [x] Force remove all worktrees (ignore if already gone)
- [x] Force delete all branches (ignore if already deleted)
- [x] Delete state file
- [x] Report collected errors as warnings

### Task 4.5: Failed state recovery

- [x] `create` detects existing failed state → clean up and retry
- [x] `close --discard` works on failed state → always succeeds

### Task 4.6: Tests for phase 4

- [x] Sync with no upstream changes (all synced immediately)
- [x] Sync with clean merge
- [x] Sync with conflicts (stops, reports)
- [x] Resume after conflict resolution
- [x] Resume with resolved-but-uncommitted changes → warning
- [x] Merge-close happy path
- [x] Merge-close blocked by dirty files
- [x] Merge-close blocked by unsynced state
- [x] Merge-close fails on ff-only (main moved)
- [x] Discard-close happy path
- [x] Discard-close from failed state
- [x] Discard-close with active merge in progress
- [x] Recovery from failed create

---

## Phase 5: End-to-End Tests

**Goal:** Verify the full lifecycle with real git repos.

**Status: COMPLETE**

### Task 5.1: E2E test infrastructure

- [x] Create `test/e2e/workspace.e2e.test.ts`
- [x] Helper to create temp git repos with commits (parent + children)
- [x] Helper to set up a parent repo with `.grove.yaml` pointing to children
- [x] Use `GROVE_WORKTREE_DIR` to isolate worktrees in temp dir
- [x] Use `GROVE_STATE_DIR` to isolate state files in temp dir
- [x] Cleanup: remove all temp dirs in afterEach/afterAll
- [x] Separate vitest config (`vitest.e2e.config.ts`) for slow tests

### Task 5.2: Simple workspace E2E

- [x] Create → verify worktree exists with correct branch
- [x] List → shows the workspace
- [x] Status → shows correct dirty/commit counts
- [x] Make changes, commit → status reflects
- [x] Sync → merges upstream changes
- [x] Close --merge → branch merged, worktree gone, state file gone
- [x] Close --discard → everything cleaned up
- [x] Switch → returns workspace root path (by branch and by ID)
- [x] List → flags missing workspaces whose root directory is gone

### Task 5.3: Grouped workspace E2E

- [x] Create with parent + 2 children → verify nested layout
- [x] Verify all repos on feature branch
- [x] Make changes across repos → status shows all
- [x] Sync with upstream changes in one child → merges correctly
- [x] Sync with conflict → stops, reports, resume works
- [x] Close --merge → all repos merged, all worktrees gone
- [x] Close --discard → force cleanup works

### Task 5.4: Edge case E2E

- [x] Create when branch already exists → preflight error, nothing touched
- [x] Create with repos on different branches → preflight error with details
- [x] Close --merge with dirty files → blocked with message
- [x] Close --discard with active merge conflict → succeeds

---

## Post-Implementation Improvements

Applied after initial implementation was complete:

- [x] Fix `detectWorkspaceFromCwd` path prefix matching bug (prevented false matches on similar paths)
- [x] Add `GROVE_STATE_DIR` env var for state directory isolation (same pattern as `GROVE_WORKTREE_DIR`)
- [x] Add stale workspace detection (`missing` flag in `listWorkspaces()`)
- [x] Add comprehensive agent-readable help system (`grove workspace help [command]`, `--help` per subcommand)
- [x] Fix redundant state lookup in `switch` subcommand
- [x] Isolate E2E test state files via `GROVE_STATE_DIR` (no longer writes to real `~/.grove/`)
