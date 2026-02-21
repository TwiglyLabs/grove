---
title: 'Multi-Repo Worktree: API-Driven Repos Parameter'
status: not_started
description: >-
  Add optional repos parameter to workspace.create() so callers can specify
  which repos to span without relying on .grove.yaml config.
tags:
  - workspace
type: feature
---

## Problem
`workspace.create()` supports multi-repo worktree creation, but only through `.grove.yaml` config — the `workspace.repos` array in the YAML determines which sibling repos get worktrees. There is no way to specify repos programmatically via the API.

This is a problem for downstream consumers (like Canopy) that need to create worktrees across dynamically-determined sets of repos. For example, Canopy's planning mode needs to create worktrees across all repos in a trellis project, where the repo list comes from the trellis manifest — not from a static `.grove.yaml` file.

The current workaround would be to write/modify `.grove.yaml` before calling `workspace.create()`, which is fragile and couples the caller to grove's config format.
## Approach
Add an optional `repos` parameter to `CreateOptions`. When provided, it overrides the `.grove.yaml` `workspace.repos` list for that create call. When not provided, behavior is unchanged (reads from config).

```typescript
// A reference to a repo — either a registered RepoId or an inline path
type RepoRef = RepoId | RepoSpec;

interface RepoSpec {
  path: string;          // absolute path, or relative to parent repo root
  name?: string;         // worktree directory name (defaults to basename of resolved path)
  remote?: string;       // git remote name (default: 'origin')
}

interface CreateOptions {
  from: RepoId;          // existing — parent repo
  repos?: RepoRef[];     // NEW — child repos to include
  signal?: AbortSignal;
}
```

Accepting `RepoRef` (a union of `RepoId | RepoSpec`) lets callers use either:
- **`RepoId`** — resolved via the grove registry. Natural for Canopy and other programmatic consumers that already have repos registered.
- **`RepoSpec`** — inline path for ad-hoc use, scripting, or repos not in the registry.

The API layer resolves all `RepoRef` entries to absolute paths before passing them to the internal `createWorkspace()` function, which already iterates a `sources` array.
## Design
### Behavior Matrix

| `repos` param | `.grove.yaml` workspace section | Result |
|---------------|-------------------------------|--------|
| provided | exists | `repos` param wins for repo list; config still used for setup/hooks |
| provided | absent | `repos` param used; no setup/hooks |
| not provided | exists | config used (current behavior) |
| not provided | absent | single-repo worktree (current behavior) |

### Type Design

**Public types** (in `workspace/types.ts`):

```typescript
// Inline repo specification — used when repo is not in the registry
export interface RepoSpec {
  path: string;          // absolute path, or relative to parent repo root
  name?: string;         // worktree directory name (defaults to basename)
  remote?: string;       // git remote (default: 'origin')
}

// A reference to a repo — either registered or inline
export type RepoRef = RepoId | RepoSpec;
```

**Internal resolved type** (in `workspace/create.ts`):

```typescript
// Fully resolved child repo — all paths absolute, name determined
interface ResolvedChildRepo {
  path: string;    // absolute path to git repo root
  name: string;    // worktree directory name
}
```

### Path Resolution Rules

| Input | Resolution |
|-------|------------|
| `RepoId` | Looked up in grove registry via `resolveRepoPath()`. Name from registry entry. |
| `RepoSpec` with absolute `path` | Used as-is. Name from `spec.name` or `basename(path)`. |
| `RepoSpec` with relative `path` | Resolved against parent repo root (`resolve(sourceRoot, path)`). Name from `spec.name` or the relative path itself (matching config behavior). |

### Validation

Config-sourced repos go through `validateRepoPaths()` which rejects absolute paths and `..` — these are config-format safety rails. API-sourced repos bypass this intentionally; programmatic callers need absolute paths and registry-resolved paths.

API-sourced repos are validated by:
1. **Deduplication** — after resolution, reject duplicate absolute paths. If the parent repo appears in `repos`, silently deduplicate (don't error).
2. **Name uniqueness** — resolved worktree directory names must be unique within the workspace.
3. **Preflight checks** — same as config repos: is a git repo, not detached HEAD, branch doesn't exist, all repos on same branch.

### Worktree Directory Naming

Child worktree directories sit under the workspace root: `~/worktrees/<project>/<branch>/<name>`.

- `RepoId` repos: name = repo entry's `name` from registry
- `RepoSpec` with `name`: uses the explicit name
- `RepoSpec` with relative `path`, no `name`: uses the path string (e.g. `"public"` → `public/`)
- `RepoSpec` with absolute `path`, no `name`: uses `basename(path)`

### What Changes

1. **`workspace/types.ts`** — add `RepoSpec`, `RepoRef`, and `repos?: RepoRef[]` to `CreateOptions`
2. **`workspace/create.ts`** — accept optional `childRepos` in internal options; when provided, build `sources` from them instead of config. Still load config for setup/hooks.
3. **`workspace/api.ts`** — resolve `RepoRef[]` to `ResolvedChildRepo[]`, handle deduplication, pass to internal create.
4. **`src/lib.ts`** — re-export `RepoSpec` and `RepoRef` from workspace namespace.

### What Doesn't Change

- `workspace.close()` — already tracks all repos in workspace state, handles multi-repo cleanup regardless of how repos were specified at creation time
- `workspace.sync()` — already iterates tracked repos from state
- `workspace.getStatus()` — reads from state, repo-agnostic
- State file format — `state.repos: WorkspaceRepoState[]` already stores per-repo state
- Setup commands — still loaded from config, still run in all repo worktrees (including API-sourced ones)
- Hooks — still loaded from config, still run in parent worktree root
## Risks
- **Low risk** — this is an additive API change. No existing callers are affected. The internal multi-repo worktree machinery already exists and is tested.
- **New cross-slice dependency** — `workspace/api.ts` already imports `resolveRepoPath` from `repo/api.ts`. This plan uses the same import path for `RepoId` resolution plus adds a `get()` call for name lookup. No new architectural coupling.
- **Name collision** — two repos could resolve to the same `basename`. The name-uniqueness validation catches this at create time with a clear error.
