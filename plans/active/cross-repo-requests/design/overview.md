# Cross-Repo Requests

Last updated: 2026-02-15

## Problem

When working in one repo, an agent (or user) often discovers it needs something from another repo — a new type, an API change, a feature. Today there's no standard way to file that request. The ask gets lost in conversation context or manually created as an ad-hoc file.

Grove already knows about all registered repos (via `grove repo`). Trellis already defines the plan format. The missing piece is a command that bridges the two: file a trellis-compatible plan into another repo's plans directory from wherever you're working.

## Solution: `grove request`

A single new CLI command that creates a draft plan in a worktree of the target repo — ready for refinement.

### Command

```
grove request <target-repo> <plan-name> --body <markdown> [--body-file <path>] [--description <one-liner>] [--json]
```

**Arguments:**
- `target-repo` — name of a repo in the grove registry (`~/.grove/repos.json`)
- `plan-name` — kebab-case name for the plan (becomes the filename). Must match `/^[a-z0-9]+(-[a-z0-9]+)*$/` — reject with a helpful message if invalid (e.g., "Plan name must be kebab-case: my-plan-name")

**Flags:**
- `--body <markdown>` — the request content (the ask, context, motivation). Must be non-empty.
- `--body-file <path>` — read request content from a file instead of `--body`. Mutually exclusive with `--body`; fail if both are provided. File must exist and be non-empty. Does not support `-` for stdin.
- `--description <text>` — optional one-line description for frontmatter
- `--json` — output structured JSON (matches all other grove commands)

**No arguments / `--help`:** print usage summary and exit.

### What It Does

1. **Validate plan name** — check that `plan-name` matches kebab-case regex. Fail with helpful message and example if not.

2. **Resolve target repo** — look up `<target-repo>` in the grove repo registry. Fail if not registered or path doesn't exist on disk.

3. **Auto-detect source repo** — resolve the requesting repo's name from cwd using worktree-aware detection (see [Source Repo Detection](#source-repo-detection) below). If no match, set source to `null` (don't fail — the command can be run from anywhere).

4. **Refuse self-requests** — if source and target resolve to the same repo, fail with message: "Cannot request from a repo to itself. Use trellis to create a plan directly."

5. **Resolve plans directory** — read `.trellis` config from the target repo root to get `plans_dir` (see [.trellis Config Parsing](#trellis-config-parsing)). Default: `plans`.

6. **Determine file path** — check for an `active/` subdirectory under `<plans_dir>`. If it exists, the plan goes at `<plans_dir>/active/<plan-name>.md`. Otherwise, `<plans_dir>/<plan-name>.md`.

7. **Duplicate detection** — in the **target repo's main checkout** (before any worktree creation), scan for an existing `<plan-name>.md` in both `<plans_dir>/` and `<plans_dir>/active/` (regardless of which was chosen in step 6). If found, fail with: "Plan '<plan-name>' already exists at <path>. Choose a different name." This prevents collisions across directory layouts.

8. **Check for existing branch** — call `branchExists(targetRepoPath, 'request/<plan-name>')` from `src/workspace/git.ts`. If it exists, fail with: "A request branch for '<plan-name>' already exists in <target-repo>. Choose a different name or close the existing request." Pre-checking gives a clear error instead of an opaque git failure.

9. **Create worktree** — branch from the target repo's current HEAD. Construct the worktree path as `join(getWorktreeBasePath(), targetRepoName, 'request', planName)` and call `createWorktree(targetRepoPath, 'request/<plan-name>', worktreePath)`. Note: the `source` parameter of `createWorktree` is the repo to branch from — which is the *target* repo in our domain language (the repo receiving the request), not the *source* repo (the requester).

10. **Create directories** — `mkdirSync(dir, { recursive: true })` for the plan directory inside the worktree.

11. **Write the plan file** in the worktree:

```markdown
---
title: <Title Cased From Plan Name>
status: draft
source: <requesting-repo-name or null>
description: "<from --description flag, or empty>"
---

<content from --body or --body-file>
```

**Title generation:** split plan name on `-`, capitalize the first letter of each segment, join with spaces. Example: `fix-api-v2` → `Fix Api V2`. No smart-casing of acronyms — keep it simple and predictable.

12. **Commit** — in the worktree, use `execSync` (imported from `child_process`) with `cwd` set to the worktree path: `git add <plan-file-path>` then `git commit -m "Add request: <plan-name> (from <source-repo>)"`. If source is null, omit the parenthetical: `Add request: <plan-name>`. The `git()` helper in `workspace/git.ts` is module-private, so use `execSync` directly (same pattern).

13. **Write workspace state** — call `writeWorkspaceState()` from `src/workspace/state.ts`. A request is a single-repo workspace. Concrete field mappings:

```typescript
{
  version: 1,
  id: `${targetRepoName}-request-${planName}`,   // e.g. "acorn-request-fix-api-v2"
  status: 'active',
  branch: `request/${planName}`,                  // e.g. "request/fix-api-v2"
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  root: worktreePath,                             // e.g. "~/worktrees/acorn/request/fix-api-v2"
  source: targetRepoPath,                         // the repo we branched FROM (WorkspaceState.source = repo path, NOT the requesting repo name)
  repos: [{
    name: targetRepoName,
    role: 'parent',                               // single-repo workspace, this is the parent
    source: targetRepoPath,                       // repo path on disk
    worktree: worktreePath,                       // worktree path on disk
    parentBranch: currentBranchOfTargetRepo,      // e.g. "main" — what we branched from
  }],
  sync: null,                                     // no sync state for a fresh request
}
```

Note the terminology: `WorkspaceState.source` is the repo path we branched from (the target repo), while the plan frontmatter `source` field is the *requesting* repo's name. Different things, same word.

14. **Print result:**
    - Text mode: show the worktree path, branch name, and plan file path.
    - JSON mode: `{ ok: true, data: { file, worktree, branch, source?, target } }`

### What This Is NOT

- **Not a tracking system** — trellis handles plan status and dependencies
- **Not cross-repo dependency linking** — the plan is a normal local plan in the target repo
- **Not a notification system** — the worktree + branch is the signal; the plan shows up when someone runs `trellis status` in that worktree
- **Not an interactive tool** — no stdin reading, no prompts. Fail with clear errors and let the caller retry with corrected args.

## Source Repo Detection

Detecting the source repo must handle worktrees, since that's the primary workflow.

**Algorithm:**

1. Run `git rev-parse --show-toplevel` from cwd. If this fails (not in a git repo), source is `null`.
2. Run `git rev-parse --git-common-dir` from cwd. This returns the path to the shared `.git` directory, which points back to the main repo even from a worktree.
3. If `--git-common-dir` returns a path ending in `/.git` (not a worktree), use `--show-toplevel` as the repo root.
4. If `--git-common-dir` returns a path like `<main-repo>/.git/worktrees/<name>`, resolve `<main-repo>` as the repo root.
5. Match the resolved repo root against registered repo paths in the registry (normalize both with `path.resolve`).
6. If a match is found, that's the source repo name. If not, source is `null`.

**Why not just match cwd?** A worktree at `~/worktrees/grove/feature-branch` won't match a registered repo at `~/repos/grove`. The git-common-dir approach resolves through the worktree indirection to find the actual repo.

## Plan Directory Resolution

This resolves where to place the plan file. Two-step process, no contradiction:

1. **Get `plans_dir`** — read from `.trellis` config (see [.trellis Config Parsing](#trellis-config-parsing)). Default: `plans`.
2. **Check for `active/` subdirectory** — if `<plans_dir>/active/` exists as a directory in the target repo, place the file at `<plans_dir>/active/<plan-name>.md`. Otherwise, place it at `<plans_dir>/<plan-name>.md`.

The default is `plans` (not `plans/active`). The `active/` check is a separate step that applies regardless of where `plans_dir` came from.

## .trellis Config Parsing

The `.trellis` file is a simple key-value format:

```
project: acorn
plans_dir: plans
```

Parser: split lines on first `:`, trim keys and values. Extract `plans_dir`. This is intentionally minimal — one field from a simple format, no trellis dependency.

**Defensive parsing:** wrap the entire read-and-parse in a try/catch. If the file is missing, unreadable, malformed, or doesn't contain a `plans_dir` key, fall back to `plans`. Log a warning in text mode if the file exists but can't be parsed. Never fail the command due to a `.trellis` parse error.

## Implementation

### New Files

**`src/commands/request.ts`** — the command handler

Core logic:
- Define a local `getFlag` helper (4-line function matching the pattern in `workspace.ts` — not worth extracting to shared util for one consumer)
- Validate plan name against kebab-case regex
- `readRegistry()` from `src/repo/state.ts` to find the target repo
- Auto-detect source repo using git-common-dir resolution (via `execSync`)
- `getCurrentBranch(targetRepoPath)` to capture the parent branch for workspace state
- Parse `.trellis` config defensively (try/catch, fall back on any error)
- Duplicate detection across `plans/` and `plans/active/` in the target repo's main checkout
- `branchExists()` pre-check, then `createWorktree()` from `src/workspace/git.ts`
- `mkdirSync` the plan directory in the worktree
- Build frontmatter YAML + body content, write the file
- `execSync('git add ...')` + `execSync('git commit ...')` with `cwd` set to worktree path
- Write workspace state via `writeWorkspaceState()` from `src/workspace/state.ts`
- Output with `printSuccess`/`jsonSuccess` or `printError`/`jsonError`/`printWarning`

**`src/commands/request.test.ts`** — unit tests (see Test Strategy below)

### Modified Files

**`src/index.ts`** — add `request` to the command router, alongside `repo` and `workspace` (config-independent category, early-return before `loadConfig()`)

### Dependencies on Existing Code

- `src/repo/state.ts` — `readRegistry()` to look up registered repos
- `src/output.ts` — `printSuccess`, `printError`, `printWarning`, `jsonSuccess`, `jsonError`, `printInfo`
- `src/workspace/git.ts` — `createWorktree()`, `getWorktreeBasePath()`, `branchExists()`, `getCurrentBranch()`
- `src/workspace/state.ts` — `writeWorkspaceState()` for workspace tracking
- No dependency on trellis as a library

### Exports That May Need Adding

All required functions are already exported:
- `writeWorkspaceState` from `src/workspace/state.ts` — exported ✓
- `getWorktreeBasePath`, `createWorktree`, `branchExists`, `getCurrentBranch` from `src/workspace/git.ts` — all exported ✓
- `readRegistry` from `src/repo/state.ts` — exported ✓

No export changes needed.

## Workflow

The intended workflow for cross-repo requests:

```
1. Agent is working in repo A, discovers it needs something from repo B
2. Agent runs: grove request B the-thing-i-need --body "## Context\n..."
3. Grove creates a worktree of repo B on branch request/the-thing-i-need
4. Plan file appears in the worktree's plans directory, committed to the branch
5. The worktree shows up in `grove workspace list`
6. User (or agent) switches to the worktree to refine the draft into an implementable plan
7. Normal trellis workflow takes over from there
8. When done, the branch merges back to the target repo's main branch
```

## Edge Cases

### Input validation
- **Plan name not kebab-case** — fail with validation message and example
- **Both `--body` and `--body-file` provided** — fail: "flags are mutually exclusive"
- **Neither `--body` nor `--body-file` provided** — fail: "one is required"
- **`--body-file` path doesn't exist** — fail with clear error
- **Empty body** — `--body ""` or empty `--body-file` content → fail: "body must not be empty"
- **No args or `--help`** — print usage and exit

### Registry and repo resolution
- **Target repo not registered** — fail with message suggesting `grove repo add`
- **Target repo path missing on disk** — fail with clear error
- **Target === source** — fail: "Cannot request from a repo to itself"

### Plan name conflicts
- **Plan file exists in `plans/`** — fail with path, suggest different name
- **Plan file exists in `plans/active/`** — fail with path, suggest different name
- **Branch `request/<plan-name>` already exists** — fail: "A request branch for '<plan-name>' already exists in <target-repo>. Choose a different name or close the existing request."

### Git state
- **Target repo on detached HEAD** — `getCurrentBranch()` returns empty string on detached HEAD. Check for this and fail: "Target repo '<name>' is on a detached HEAD. Check out a branch first."
- **Target repo mid-rebase/merge** — fail: git state must be clean for worktree creation (git itself will reject the worktree add)
- **Target repo has dirty working tree** — OK: worktree creation operates on the branch, not the working tree

### .trellis and directory structure
- **No `.trellis` and no `plans/active/`** — create `plans/` via mkdirSync recursive
- **Malformed `.trellis`** — fall back to default `plans` directory, warn in text mode

## Test Strategy

Tests use vitest with temp directories and mocked `os.homedir()`, matching existing patterns in `src/commands/repo.test.ts`. Tests that verify git operations use real temp git repos (not mocked git).

### Unit Tests (`src/commands/request.test.ts`)

**Happy path:**
- Creates worktree at expected path with correct branch name
- Plan file has correct frontmatter (title, status, source, description) and body
- Commits the file with expected message (including source repo attribution)
- Text output includes worktree path, branch, and file path
- `--json` mode returns structured `{ ok: true, data: { file, worktree, branch, source, target } }`
- Source repo auto-detected and included in frontmatter
- Workspace state file written (worktree appears in workspace list)

**Plan name validation:**
- Rejects names with spaces, dots, slashes, uppercase, leading/trailing hyphens
- Accepts valid kebab-case names (`my-plan`, `a`, `fix-api-v2`)

**Title generation:**
- `my-plan` → `My Plan`
- `fix-api-v2` → `Fix Api V2`
- `a` → `A`

**Body input:**
- `--body` flag provides content inline
- `--body-file` reads content from file
- Fails when both `--body` and `--body-file` given
- Fails when neither provided
- Fails on empty `--body` or empty `--body-file`

**Registry lookup:**
- Fails with helpful message when target repo not registered
- Fails when registered path doesn't exist on disk

**Self-request detection:**
- Fails when target and source resolve to the same repo

**Source detection (worktree-aware):**
- Detects source repo when cwd is inside a registered repo directly
- Detects source repo when cwd is inside a worktree of a registered repo
- Sets source to null when cwd doesn't match any registered repo
- Sets source to null when not in a git repo at all

**`.trellis` parsing:**
- Reads `plans_dir` from valid `.trellis` config
- Falls back to `plans` when `.trellis` is missing
- Falls back to `plans` when `.trellis` is malformed
- Falls back to `plans` when `.trellis` has no `plans_dir` key

**Plan directory resolution:**
- Uses `<plans_dir>/active/` when that directory exists
- Uses `<plans_dir>/` when no `active/` subdirectory
- Creates directory structure when missing

**Duplicate detection:**
- Fails when `<plan-name>.md` exists in `<plans_dir>/`
- Fails when `<plan-name>.md` exists in `<plans_dir>/active/`
- Fails when `request/<plan-name>` branch already exists in target repo
- Error message includes the conflicting path

**Worktree creation:**
- Creates worktree at `<base>/<project>/request/<plan-name>`
- Branch name is `request/<plan-name>`
- Branches from target repo's current HEAD
- Fails when branch already exists (pre-check with `branchExists`)
- Fails when target repo is on detached HEAD (empty `getCurrentBranch` result)

**Workspace state:**
- State written with correct `id` format: `<targetRepoName>-request-<planName>`
- `status` is `'active'`
- `branch` matches `request/<plan-name>`
- `root` matches worktree path
- `source` is the target repo path (not the requesting repo name)
- `repos` has single entry with `role: 'parent'`
- `repos[0].parentBranch` is the branch the target repo was on when the request was created
- `sync` is `null`
- Worktree appears in `grove workspace list` after creation

**Usage output:**
- No args prints usage and exits
- `--help` prints usage and exits
