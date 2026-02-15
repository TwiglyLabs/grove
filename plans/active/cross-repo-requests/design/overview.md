# Cross-Repo Requests

Last updated: 2026-02-14

## Problem

When working in one repo, an agent (or user) often discovers it needs something from another repo — a new type, an API change, a feature. Today there's no standard way to file that request. The ask gets lost in conversation context or manually created as an ad-hoc file.

Grove already knows about all registered repos (via `grove repo`). Trellis already defines the plan format. The missing piece is a command that bridges the two: file a trellis-compatible plan into another repo's plans directory from wherever you're working.

## Solution: `grove request`

A single new CLI command that creates a draft plan in a target repo.

### Command

```
grove request <target-repo> <plan-name> --body <markdown> [--description <one-liner>] [--no-commit]
```

**Arguments:**
- `target-repo` — name of a repo in the grove registry (`~/.grove/repos.json`)
- `plan-name` — kebab-case name for the plan (becomes the filename)

**Flags:**
- `--body <markdown>` — the request content (the ask, context, motivation)
- `--description <text>` — optional one-line description for frontmatter
- `--no-commit` — create the file but skip the git commit

### What It Does

1. **Resolve target repo** — look up `<target-repo>` in the grove repo registry. Fail if not registered or path doesn't exist on disk.

2. **Find plans directory** — read `.trellis` config in the target repo root to get `plans_dir`. Fall back to `plans/active` if no `.trellis` file exists.

3. **Determine file path** — `<plans_dir>/active/<plan-name>.md` if an `active/` subdirectory exists, otherwise `<plans_dir>/<plan-name>.md`. Fail if a file already exists at that path.

4. **Write the plan file:**

```markdown
---
title: <Title Cased From Plan Name>
status: draft
description: "<from --description flag, or empty>"
---

<content from --body flag>
```

5. **Commit** — `git add` the new file and commit to the target repo's current branch with message `Add request: <plan-name>`. Skip if `--no-commit`.

6. **Print result** — show the created file path (and commit hash if committed).

### What This Is NOT

- **Not a tracking system** — trellis handles plan status and dependencies
- **Not cross-repo dependency linking** — the plan is a normal local plan in the target repo
- **Not a notification system** — the git commit is the signal; the plan shows up when someone runs `trellis status` in the target repo

## Implementation

### New Files

**`src/commands/request.ts`** — the command handler

Core logic:
- Parse args and flags
- `readRegistry()` from `src/repo/state.ts` to find the target repo
- Parse `.trellis` config (simple key-value format: `plans_dir = plans`) with a small helper
- Build frontmatter YAML + body content
- Write the file, optionally commit via `git` subprocess

### Modified Files

**`src/index.ts`** — add `request` to the command router, alongside `repo` and `workspace`

### Dependencies on Existing Code

- `src/repo/state.ts` — `readRegistry()` to look up registered repos
- No dependency on trellis as a library — we just need to understand the `.trellis` config format (a flat key-value file) and the plan frontmatter format (standard YAML)

### .trellis Config Parsing

The `.trellis` file is a simple format:

```
project: acorn
plans_dir: plans
```

We need a small parser (or just split lines on `:`) to extract `plans_dir`. This is intentionally minimal — we're reading one field from a simple format, not importing trellis.

## Workflow

The intended workflow for cross-repo requests:

```
1. Agent is working in repo A, discovers it needs something from repo B
2. Agent runs: grove request B the-thing-i-need --body "## Context\n..."
3. Plan file appears in repo B's plans directory, committed to main
4. User (or agent) creates a worktree for repo B to refine and implement the request
5. In the worktree, the draft plan gets refined into an implementable plan
6. Normal trellis workflow takes over from there
```

## Edge Cases

- **Target repo not registered** — fail with message suggesting `grove repo add`
- **Target repo path missing on disk** — fail with clear error
- **Plan name already exists** — fail, don't overwrite
- **Target repo has dirty git state** — still commit (we're only touching the new file via `git add <specific-file>`)
- **No `.trellis` and no `plans/active/`** — create the directory structure
