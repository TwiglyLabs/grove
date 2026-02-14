# Grove Workspace Management: Operations

Last updated: 2026-02-13

## CLI Commands

```
grove workspace create <branch> [--from <path>]
grove workspace list
grove workspace status [<branch>]
grove workspace sync <branch>
grove workspace close <branch> --merge
grove workspace close <branch> --discard
```

All commands accept `--json` for machine-readable output.

---

## `grove workspace create <branch>`

Create an isolated workspace with coordinated feature branches.

**Detection logic:**
1. If `--from <path>` provided, use that as source repo
2. Otherwise, detect repo from cwd (`git rev-parse --show-toplevel`)
3. Look for `.grove.yaml` with `workspace.repos` → grouped
4. No workspace config → simple (single-repo)

**Grouped workspace flow:**
1. Read `.grove.yaml`, validate workspace config
2. Validate all child repos exist at declared paths and are git repos
3. Determine parent branch for each repo (`git -C <source> branch --show-current`)
4. Write state file with `status: "creating"`
5. Create parent worktree: `git -C <source> worktree add -b <branch> ~/worktrees/<project>/<branch>`
6. For each child repo:
   - `git -C <source>/<path> worktree add -b <branch> ~/worktrees/<project>/<branch>/<path>`
7. Update state to `status: "active"`
8. Print workspace root path

**Simple workspace flow:**
Same as above but `repos` has one entry (the current repo) and no nesting.

**Rollback on failure:**
If any step fails, remove all worktrees created so far, delete branches, set `status: "failed"`.

**Output:**
```json
{
  "ok": true,
  "data": {
    "id": "acorn-feature-x",
    "root": "/Users/bmatola/worktrees/acorn/feature-x",
    "repos": ["acorn", "public", "cloud"],
    "branch": "feature-x"
  }
}
```

---

## `grove workspace list`

List all workspaces from `~/.grove/workspaces/*.json`.

**Output:**
```json
{
  "ok": true,
  "data": {
    "workspaces": [
      {
        "id": "acorn-feature-x",
        "branch": "feature-x",
        "status": "active",
        "root": "/Users/bmatola/worktrees/acorn/feature-x",
        "repos": ["acorn", "public", "cloud"],
        "createdAt": "2026-02-13T10:00:00Z"
      }
    ]
  }
}
```

---

## `grove workspace status [<branch>]`

Show detailed status of a workspace. If no branch given, detect from cwd.

For each repo, gather:
- Dirty files (`git status --porcelain`)
- Commits ahead of parent branch (`git rev-list --count <parent>..<branch>`)
- Current sync status

**Output:**
```json
{
  "ok": true,
  "data": {
    "id": "acorn-feature-x",
    "status": "active",
    "branch": "feature-x",
    "repos": [
      {
        "name": "acorn",
        "role": "parent",
        "dirty": 2,
        "commits": 5,
        "syncStatus": null
      },
      {
        "name": "public",
        "role": "child",
        "dirty": 0,
        "commits": 12,
        "syncStatus": null
      }
    ]
  }
}
```

---

## `grove workspace sync <branch>`

Merge upstream main into each repo's feature branch. Resumable — picks up where it left off.

**Flow:**
1. Load workspace state
2. Initialize sync progress if not present (all repos `pending`)
3. For each repo with status `pending` (in order: parent first, then children):
   - `git -C <worktree> fetch origin`
   - `git -C <worktree> merge origin/<parentBranch>`
   - If clean: mark `synced`
   - If conflicts: mark `conflicted`, stop, report files
4. If all synced: clear sync state, update timestamp
5. If conflicted: exit with error, structured conflict data

**Resuming after conflict resolution:**
User/Claude resolves conflicts in the workspace, commits. Re-runs `grove workspace sync <branch>`. The tool sees the previously-conflicted repo no longer has conflicts (no merge in progress), marks it `synced`, continues to next `pending` repo.

**Output (conflict):**
```json
{
  "ok": false,
  "error": "Merge conflicts in public",
  "data": {
    "conflicted": "public",
    "files": ["src/db/schema.ts", "src/mcp/server.ts"],
    "resolved": ["acorn"],
    "pending": ["cloud"]
  }
}
```

---

## `grove workspace close <branch> --merge`

Merge all feature branches back to their parent branches and clean up.

**Flow:**
1. Load workspace state, set `status: "closing"`
2. Check no uncommitted changes in any repo (abort if dirty, suggest commit first)
3. Check all repos are synced (if not, prompt to sync first)
4. For each repo (children first, then parent):
   - `git -C <source> checkout <parentBranch>`
   - `git -C <source> merge --ff-only <branch>`
   - If ff-only fails: abort entire close, suggest re-sync (main moved since last sync)
   - `git -C <source> worktree remove <worktree-path>`
   - `git -C <source> branch -d <branch>`
5. Delete state file

**Why children first:** Parent repo may reference child changes (e.g., updated submodule pointers, updated plan docs). Merging children first ensures those references are valid.

---

## `grove workspace close <branch> --discard`

Delete all branches and worktrees without merging.

**Flow:**
1. Set `status: "closing"`
2. For each repo:
   - `git -C <source> worktree remove --force <worktree-path>`
   - `git -C <source> branch -D <branch>`
3. Delete state file

---

## Error Recovery

**Failed create:** State file exists with `status: "failed"`. User can:
- Re-run `create` (tool detects existing failed state, cleans up, retries)
- Run `close --discard` to clean up

**Failed close:** State file exists with `status: "failed"`. User can:
- Retry the close operation
- Manually fix and then `close --discard`

**Interrupted sync:** Sync progress is persisted. Re-running `sync` picks up from last position.
