# Grove Repo Registry: Overview

Last updated: 2026-02-14

## Problem Statement

The Emacs dashboard needs to know which repos to display. This knowledge should live in grove (source of truth), not in Emacs config. Repos are registered once and persist across sessions.

## Solution: `grove repo` Subcommand

A simple registry of repos the user cares about, stored in `~/.grove/repos.json`.

### CLI Commands

```
grove repo add [<path>]        # register a repo (defaults to cwd)
grove repo remove <name>       # unregister by name
grove repo list                # all registered repos (--json)
```

### State File: `~/.grove/repos.json`

```json
{
  "version": 1,
  "repos": [
    {
      "name": "dotfiles",
      "path": "/Users/bmatola/dotfiles",
      "addedAt": "2026-02-14T10:00:00Z"
    },
    {
      "name": "acorn",
      "path": "/Users/bmatola/repos/twiglylabs/acorn",
      "addedAt": "2026-02-14T10:05:00Z"
    }
  ]
}
```

### `grove repo list --json` Output

Enriched with workspace data so the dashboard gets everything in one call:

```json
{
  "ok": true,
  "data": {
    "repos": [
      {
        "name": "dotfiles",
        "path": "/Users/bmatola/dotfiles",
        "workspaces": [
          {
            "id": "dotfiles-fix-zsh",
            "branch": "fix-zsh",
            "status": "active",
            "root": "/Users/bmatola/worktrees/dotfiles/fix-zsh",
            "repos": [
              { "name": "dotfiles", "role": "parent", "dirty": 0, "commits": 3 }
            ]
          }
        ]
      },
      {
        "name": "acorn",
        "path": "/Users/bmatola/repos/twiglylabs/acorn",
        "workspaces": [
          {
            "id": "acorn-feature-auth",
            "branch": "feature-auth",
            "status": "active",
            "root": "/Users/bmatola/worktrees/acorn/feature-auth",
            "repos": [
              { "name": "acorn", "role": "parent", "dirty": 0, "commits": 2 },
              { "name": "public", "role": "child", "dirty": 2, "commits": 5 },
              { "name": "cloud", "role": "child", "dirty": 0, "commits": 1 }
            ]
          }
        ]
      }
    ]
  }
}
```

This is the **single call** the Emacs dashboard makes to populate itself. One command, all the data.

### Behaviors

- `grove repo add` from a git repo root registers it by directory name
- `grove repo add` from a non-git directory errors
- `grove repo remove` by name, not path
- Duplicate adds (same path) are no-ops
- Name collisions (different paths, same directory name) error — user should rename the directory or we add an alias feature later
- `grove repo list` joins repo registry with workspace state — workspaces are matched to repos by their `source` path

### Scope

- No auto-discovery (explicit registration only)
- No validation that registered repos still exist (stale repos shown with a flag)
- No grouping/tagging (flat list, alphabetical)

## Implementation

Small scope — one new command file, one new state file, extend list to join with workspace data.

### Files

| File | Status | Description |
|------|--------|-------------|
| `src/repo/types.ts` | NEW | RepoRegistry zod schema |
| `src/repo/state.ts` | NEW | Read/write `~/.grove/repos.json` |
| `src/repo/list.ts` | NEW | List with workspace enrichment |
| `src/commands/repo.ts` | NEW | Command router for `grove repo` |
| `src/index.ts` | MODIFY | Add repo command to main router |

### Tasks

- [ ] Create types and state management for repo registry
- [ ] Implement add/remove/list commands
- [ ] Join repo list with workspace state for enriched output
- [ ] Wire into main CLI router
- [ ] Tests: add, remove, duplicate, list with workspaces, stale repo detection
- [ ] `--json` support on all subcommands
