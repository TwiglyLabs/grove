# Grove Workspace Management: Overview

Last updated: 2026-02-13

## Problem Statement

TwiglyLabs projects span multiple repositories. For example, Acorn has a planning repo with `public/` and `cloud/` as gitignored child repos. Today, Claude Code sessions are scoped to a single repo — cross-repo work requires separate sessions with no coordination.

We need a way to:
1. Create isolated workspaces that bundle worktrees from multiple repos
2. Work across all repos in a single Claude session
3. Sync with upstream changes and resolve conflicts in-place
4. Merge or discard all branches atomically

## Solution: Grouped Workspaces in Grove

Extend Grove's CLI with a `workspace` subcommand that orchestrates git worktrees across multiple repos as a single unit.

### Core Concepts

**Workspace** — An isolated working environment with one or more repos on coordinated feature branches. Two types:

- **Simple** — Single repo, no config needed. Replaces current Emacs-managed worktrees.
- **Grouped** — Parent repo + children declared in `.grove.yaml`. All repos share one branch name.

**Atomic lifecycle** — All repos in a workspace are created, synced, and closed together. No partial merges.

**Config-driven** — `.grove.yaml` in the parent repo declares child repos. The tool reads this to know what to bundle.

### Architecture

```
grove workspace create feature-x
         │
         ├── Read .grove.yaml → discover repos
         ├── git worktree add (parent)
         ├── git worktree add (child 1, nested inside parent)
         ├── git worktree add (child 2, nested inside parent)
         └── Write state to ~/.grove/workspaces/

grove workspace sync feature-x
         │
         ├── For each repo: git fetch + git merge origin/main
         ├── On conflict: stop, report, user/Claude resolves
         └── Resumable — picks up from last conflicted repo

grove workspace close feature-x --merge
         │
         ├── Verify all repos synced (ff-only should succeed)
         ├── For each repo (children first): merge into main
         ├── Remove all worktrees
         └── Delete state file
```

### Key Design Decisions

1. **Physical layout mirrors source** — Grouped workspace nests child worktrees where child repos normally live. All CLAUDE.md files and relative paths work as-is.
2. **One branch name per workspace** — Simple mental model. `feature-x` everywhere.
3. **Sync before close** — Conflicts surface in the workspace where Claude has full context, not during teardown.
4. **CLI owns all state** — Emacs becomes a thin UI layer that shells out to `grove --json`.
5. **State in `~/.grove/workspaces/`** — Global directory, not per-repo, since workspaces span repos.
6. **Simple state machine** — creating/active/closing/failed. No reconciliation complexity.

### What's NOT in Scope

- Auto-cloning child repos (they must already exist at declared paths)
- Integration with `grove up` / K8s infra (independent for now)
- Remote push / PR creation (user handles that)
- Submodule conversion (repos stay gitignored, worktrees handle isolation)
