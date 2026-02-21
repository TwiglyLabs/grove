---
title: Setup Automation
status: done
description: >-
  Add setup command list and lifecycle hooks to .grove.yaml, run automatically
  after workspace creation
depends_on:
  - clean-library-api
tags:
  - workspace
  - canopy
not_started_at: '2026-02-21T02:02:29.483Z'
completed_at: '2026-02-21T03:20:09.370Z'
---

## Problem
When Grove creates a worktree, it's a bare checkout — no `node_modules`, no generated code, no migrations run. Today a human runs `npm install` manually. When Canopy provisions a worktree for a Claude instance, the environment needs to be ready to use immediately. There's no automated bridge between "worktree exists" and "code can build and run."
## Approach
Add a `setup` config section to `.grove.yaml`:

```yaml
workspace:
  repos:
    - name: api
      role: parent
  setup:
    - npm install
    - npx prisma generate
    - npm run codegen
  hooks:
    postCreate: ./scripts/post-create.sh
    preUp: ./scripts/pre-up.sh
```

**Config placement:** Both `setup` and `hooks` live under `workspace:` — they are workspace lifecycle concerns. Setup commands run after worktree creation. Hooks fire at specific lifecycle points.

Commands run sequentially in each repo's worktree root after `workspace.create()`. Each command's stdout/stderr is captured and returned as structured data (not printed — the API stays library-clean).

`workspace.create()` becomes the full provisioning call: create worktrees → run setup commands per repo → run postCreate hook → return result with setup output.
## Steps
1. Add `SetupCommandSchema` (array of strings) and `HooksSchema` (`postCreate`, `preUp`, `postUp` — all optional strings) to `workspace/types.ts`
2. Add `setup` and `hooks` fields to `WorkspaceConfigSchema` in `workspace/types.ts`
3. Register updated schema in `src/config.ts` compositor (if not already pulled in via WorkspaceConfigSchema)
4. Implement `runSetupCommands(commands, cwd)` in workspace API — runs commands sequentially via `child_process`, captures stdout/stderr, fails fast on non-zero exit. Returns `SetupResult[]` with `{ command, exitCode, stdout, stderr, durationMs }`
5. Integrate into `workspace.create()` — after worktree creation, run setup commands for each repo's worktree
6. Implement lifecycle hook execution (`runHook(hookPath, cwd)`) — same pattern as setup but single command from a script path
7. Wire `postCreate` hook to fire after setup commands complete
8. Handle partial failures — if setup fails midway, mark workspace status as `failed`, include which command failed and its output in the result
9. Tests: mock `child_process.execSync`/`spawn`, verify sequential execution, verify failure handling, verify workspace state on partial failure
