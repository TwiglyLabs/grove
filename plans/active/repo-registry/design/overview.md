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

### Two-Tier Data Loading

The dashboard needs to render fast, but live git stats (dirty file counts, commit counts) require running git commands in every repo of every workspace. With N repos × M workspaces, that blocks the UI.

**Solution:** Split into a fast tier (state files only) and a slow tier (live git stats). The UI calls the fast tier to render immediately, then backgrounds the slow tier to fill in details.

**Tier 1 — `grove repo list --json` (instant, no git calls)**

Reads `repos.json` + workspace state files. No git commands.

```json
{
  "ok": true,
  "data": {
    "repos": [
      {
        "name": "dotfiles",
        "path": "/Users/bmatola/dotfiles",
        "exists": true,
        "workspaces": [
          {
            "id": "dotfiles-fix-zsh",
            "branch": "fix-zsh",
            "status": "active",
            "root": "/Users/bmatola/worktrees/dotfiles/fix-zsh",
            "repoCount": 1
          }
        ]
      },
      {
        "name": "acorn",
        "path": "/Users/bmatola/repos/twiglylabs/acorn",
        "exists": true,
        "workspaces": [
          {
            "id": "acorn-feature-auth",
            "branch": "feature-auth",
            "status": "active",
            "root": "/Users/bmatola/worktrees/acorn/feature-auth",
            "repoCount": 3
          }
        ]
      }
    ]
  }
}
```

**Tier 2 — `grove workspace status <id> --json` (per workspace, has git stats)**

Already exists (`src/workspace/status.ts`). Returns `dirty`/`commits` per repo. The UI calls this in the background for each workspace returned by tier 1.

```json
{
  "ok": true,
  "data": {
    "id": "acorn-feature-auth",
    "status": "active",
    "branch": "feature-auth",
    "repos": [
      { "name": "acorn", "role": "parent", "dirty": 0, "commits": 2 },
      { "name": "public", "role": "child", "dirty": 2, "commits": 5 },
      { "name": "cloud", "role": "child", "dirty": 0, "commits": 1 }
    ]
  }
}
```

The UI renders the repo list and workspace summaries immediately from tier 1, then progressively fills in per-repo stats as tier 2 calls complete.

### Behaviors

- `grove repo add` from a git repo root registers it by directory name
- `grove repo add` from a non-git directory errors
- `grove repo add` inside a child repo (e.g., `acorn/public/`) errors — register the parent repo instead
- `grove repo remove` by name, not path
- Duplicate adds (same path) are no-ops
- Name collisions (different paths, same directory name) error — user should rename the directory or we add an alias feature later
- `grove repo list` joins repo registry with workspace state — workspaces matched to repos by `workspace.source === repo.path`
- All subcommands support `--json` using the standard envelope (`{ ok, data }` / `{ ok, error }`)
  - `add` returns `{ ok: true, data: { name, path } }`
  - `remove` returns `{ ok: true, data: { name } }`
  - `list` returns the tier 1 schema above

### Scope

- No auto-discovery (explicit registration only)
- Stale repos (path no longer exists) shown with `"exists": false` — not removed automatically
- No grouping/tagging (flat list, alphabetical)
- No live git stats in `repo list` — that's tier 2 via `grove workspace status`

## Implementation

Small scope — one new command file, one new state file, list joins with workspace state (no git calls).

### State directory

Repo registry base path derived from `GROVE_STATE_DIR` (same as workspace state in `src/workspace/state.ts`), defaulting to `~/.grove/`. This keeps testability consistent — tests override `GROVE_STATE_DIR` to avoid touching the real home directory.

### Locking

`repos.json` uses `proper-lockfile` for read-modify-write in `add`/`remove`, consistent with workspace state.

### Files

| File | Status | Description |
|------|--------|-------------|
| `src/repo/types.ts` | NEW | RepoRegistry zod schema |
| `src/repo/state.ts` | NEW | Read/write `repos.json` (respects `GROVE_STATE_DIR`) |
| `src/repo/list.ts` | NEW | List with workspace join (reuses `listWorkspaceStates` from `src/workspace/state.ts`) |
| `src/commands/repo.ts` | NEW | Command router for `grove repo` |
| `src/index.ts` | MODIFY | Add repo command to main router |

### Tasks

- [ ] Create types and state management for repo registry
- [ ] Implement add/remove/list commands
- [ ] Join repo list with workspace state metadata (no git calls — reuse `listWorkspaceStates`)
- [ ] Wire into main CLI router
- [ ] Tests: add, remove, duplicate, child-repo rejection, list with workspaces, stale repo detection
- [ ] `--json` envelope on all subcommands
