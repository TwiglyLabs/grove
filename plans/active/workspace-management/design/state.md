# Grove Workspace Management: State

Last updated: 2026-02-13

## State Location

```
~/.grove/workspaces/<workspace-id>.json
```

Workspace ID is `<project>-<branch>` where project is the parent repo directory name. Example: `acorn-feature-x`.

## State Schema

```json
{
  "version": 1,
  "id": "acorn-feature-x",
  "status": "active",
  "branch": "feature-x",
  "createdAt": "2026-02-13T10:00:00Z",
  "updatedAt": "2026-02-13T14:00:00Z",
  "root": "/Users/bmatola/worktrees/acorn/feature-x",
  "source": "/Users/bmatola/repos/twiglylabs/acorn",
  "repos": [
    {
      "name": "acorn",
      "role": "parent",
      "source": "/Users/bmatola/repos/twiglylabs/acorn",
      "worktree": "/Users/bmatola/worktrees/acorn/feature-x",
      "parentBranch": "main"
    },
    {
      "name": "public",
      "role": "child",
      "source": "/Users/bmatola/repos/twiglylabs/acorn/public",
      "worktree": "/Users/bmatola/worktrees/acorn/feature-x/public",
      "parentBranch": "main"
    },
    {
      "name": "cloud",
      "role": "child",
      "source": "/Users/bmatola/repos/twiglylabs/acorn/cloud",
      "worktree": "/Users/bmatola/worktrees/acorn/feature-x/cloud",
      "parentBranch": "main"
    }
  ],
  "sync": null
}
```

### Sync Progress (when active)

```json
{
  "sync": {
    "startedAt": "2026-02-13T12:00:00Z",
    "repos": {
      "acorn": "synced",
      "public": "conflicted",
      "cloud": "pending"
    }
  }
}
```

Sync repo statuses: `pending` | `synced` | `conflicted`

## State Machine

```
creating → active → closing → (deleted)
    ↓                   ↓
  failed             failed
```

Four statuses total. No broken/stuck/reconcile — the CLI is stateless between calls, so recovery is "retry the operation."

- **creating**: Worktrees being set up. If interrupted, `failed`.
- **active**: Normal working state.
- **closing**: Merge/discard in progress. If interrupted, `failed`.
- **failed**: Something went wrong. User can retry or discard.

## Zod Schema

```typescript
const SyncStatus = z.enum(['pending', 'synced', 'conflicted']);

const WorkspaceRepoState = z.object({
  name: z.string(),
  role: z.enum(['parent', 'child']),
  source: z.string(),
  worktree: z.string(),
  parentBranch: z.string(),
});

const SyncState = z.object({
  startedAt: z.string(),
  repos: z.record(SyncStatus),
}).nullable();

const WorkspaceState = z.object({
  version: z.literal(1),
  id: z.string(),
  status: z.enum(['creating', 'active', 'closing', 'failed']),
  branch: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  root: z.string(),
  source: z.string(),
  repos: z.array(WorkspaceRepoState),
  sync: SyncState,
});
```

## CLI Output Envelope

All `--json` output uses a consistent envelope:

```typescript
// Success
interface SuccessResponse<T> {
  ok: true;
  data: T;
}

// Error
interface ErrorResponse<T = unknown> {
  ok: false;
  error: string;
  data?: T;
}
```

Errors include structured `data` when useful (e.g., conflicted file list). Non-zero exit code on failure.
