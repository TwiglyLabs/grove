
## Steps
### Step 1: Add types

**File:** `src/workspace/types.ts`

Add the new types after the existing `CreateOptions` interface:

```typescript
export interface RepoSpec {
  path: string;
  name?: string;
  remote?: string;
}

export type RepoRef = RepoId | RepoSpec;
```

Update `CreateOptions`:

```typescript
export interface CreateOptions {
  from: RepoId;
  repos?: RepoRef[];    // NEW
  signal?: AbortSignal;
}
```

**Tests:** Type-level only — verified by the build.

---

### Step 2: Update internal create to accept pre-resolved child repos

**File:** `src/workspace/create.ts`

Change the internal options type:

```typescript
export async function createWorkspace(
  branch: string,
  options: {
    from?: string;
    childRepos?: Array<{ path: string; name: string }>;
  } = {},
): Promise<CreateResult>
```

Update the `sources` array construction (lines 42–59):

```typescript
// Build source list
const sources: Array<{ path: string; role: 'parent' | 'child'; name?: string }> = [
  { path: sourceRoot, role: 'parent' },
];

if (options.childRepos && options.childRepos.length > 0) {
  // API-provided repos — already resolved to absolute paths
  for (const repo of options.childRepos) {
    sources.push({ path: repo.path, role: 'child', name: repo.name });
  }
} else if (workspaceConfig?.repos) {
  // Config-provided repos — resolve relative to parent root
  const pathErrors = validateRepoPaths(workspaceConfig.repos.map(r => r.path));
  if (pathErrors.length > 0) {
    throw new Error(pathErrors.join('\n'));
  }
  for (const repo of workspaceConfig.repos) {
    sources.push({ path: resolve(sourceRoot, repo.path), role: 'child', name: repo.path });
  }
}
```

Config is still loaded unconditionally (needed for setup commands and hooks). Only the repo list source changes.

**Tests:** `create.test.ts` — new test cases:
- `childRepos` provided → uses those instead of config repos
- `childRepos` empty array → single-repo workspace (same as no config)
- `childRepos` provided + config exists → childRepos wins, setup/hooks from config still run

---

### Step 3: Update API layer to resolve RepoRef[]

**File:** `src/workspace/api.ts`

Add a resolver function:

```typescript
import { resolveRepoPath, get as getRepo } from '../repo/api.js';
import { isRepoId } from '../shared/identity.js';
import type { RepoRef, RepoSpec } from './types.js';

interface ResolvedChildRepo {
  path: string;
  name: string;
}

async function resolveRepoRefs(
  refs: RepoRef[],
  parentPath: string,
): Promise<ResolvedChildRepo[]> {
  const resolved: ResolvedChildRepo[] = [];
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();

  for (const ref of refs) {
    let path: string;
    let name: string;

    if (typeof ref === 'string' && isRepoId(ref)) {
      // RepoId — resolve via registry
      path = await resolveRepoPath(ref);
      const entry = await getRepo(ref);
      name = entry.name;
    } else {
      const spec = ref as RepoSpec;
      if (spec.path.startsWith('/') || /^[A-Za-z]:/.test(spec.path)) {
        // Absolute path
        path = spec.path;
        name = spec.name ?? basename(spec.path);
      } else {
        // Relative path — resolve against parent repo root
        path = resolve(parentPath, spec.path);
        name = spec.name ?? spec.path;
      }
    }

    // Deduplicate: skip if same as parent
    const realPath = realpathSync(path);
    const parentReal = realpathSync(parentPath);
    if (realPath === parentReal) continue;

    // Validate uniqueness
    if (seenPaths.has(realPath)) {
      throw new Error(`Duplicate repo path: ${path}`);
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate repo name '${name}' — use the 'name' field to disambiguate`);
    }

    seenPaths.add(realPath);
    seenNames.add(name);
    resolved.push({ path: realPath, name });
  }

  return resolved;
}
```

Update `create()` to use it:

```typescript
export async function create(
  branch: string,
  options: CreateOptions,
  _events?: WorkspaceEvents,
): Promise<CreateResult> {
  const repoPath = await resolveRepoPath(options.from);

  // Resolve repo refs if provided
  let childRepos: Array<{ path: string; name: string }> | undefined;
  if (options.repos && options.repos.length > 0) {
    childRepos = await resolveRepoRefs(options.repos, repoPath);
  }

  const result = await internalCreate(branch, { from: repoPath, childRepos });
  // ... rest unchanged
}
```

**Tests:** `api.test.ts` — new test cases:
- `repos` with `RepoId` entries → resolved via registry
- `repos` with `RepoSpec` absolute path → used as-is
- `repos` with `RepoSpec` relative path → resolved against parent root
- `repos` with explicit `name` → name used for worktree directory
- `repos` containing parent repo → silently deduplicated
- `repos` with duplicate paths → throws
- `repos` with duplicate names → throws with disambiguation hint
- `repos` with non-existent `RepoId` → throws `RepoNotFoundError`

---

### Step 4: Re-export new types

**File:** `src/lib.ts`

Add `RepoSpec` and `RepoRef` to the workspace type re-exports.

**Tests:** Build verification only.

---

### Step 5: Integration test

**File:** `src/workspace/create.test.ts` (extend existing)

Add an integration-style test that exercises the full flow:
1. Set up 3 temporary git repos (parent + 2 children)
2. Register children in the repo registry
3. Call `createWorkspace(branch, { from: parent, childRepos: [child1, child2] })`
4. Assert: worktrees created at expected paths for all 3 repos
5. Assert: state file has 3 entries with correct roles and names
6. Assert: all worktrees are on the new branch
7. Close workspace and verify cleanup

## Test Strategy
### Unit Tests

| Area | Test | File |
|------|------|------|
| Types | `RepoRef` accepts both `RepoId` and `RepoSpec` | Build verification |
| Resolution | `RepoId` resolves to registry path and name | `api.test.ts` |
| Resolution | Absolute `RepoSpec` used as-is, name from basename | `api.test.ts` |
| Resolution | Relative `RepoSpec` resolved against parent root | `api.test.ts` |
| Resolution | Explicit `name` field overrides derived name | `api.test.ts` |
| Dedup | Parent repo in `repos` is silently skipped | `api.test.ts` |
| Validation | Duplicate paths after resolution → error | `api.test.ts` |
| Validation | Duplicate names → error with disambiguation hint | `api.test.ts` |
| Validation | Non-existent RepoId → `RepoNotFoundError` | `api.test.ts` |
| Internal | `childRepos` builds sources from arg, not config | `create.test.ts` |
| Internal | Empty `childRepos` → single-repo workspace | `create.test.ts` |
| Internal | `childRepos` + config → childRepos wins, setup still runs | `create.test.ts` |

### Integration Tests

| Test | Description |
|------|-------------|
| Full lifecycle with API repos | Create with `childRepos`, verify worktrees, close, verify cleanup |
| Regression: config repos | Existing config-based multi-repo creation still works identically |

## Acceptance Criteria
1. `workspace.create(branch, { from, repos: [RepoId, RepoId] })` creates worktrees across all specified repos
2. `workspace.create(branch, { from, repos: [{ path: '/abs/path' }] })` works with absolute paths
3. `workspace.create(branch, { from, repos: [{ path: 'relative' }] })` resolves relative to parent root
4. When `repos` is provided, `.grove.yaml` `workspace.repos` is ignored for the repo list
5. When `repos` is provided, `.grove.yaml` `setup` and `hooks` still execute
6. When `repos` is omitted, behavior is identical to current (no regression)
7. `RepoSpec` and `RepoRef` types are exported from `@twiglylabs/grove`
8. All existing tests pass unchanged
9. `npm run build` succeeds with no type errors

## Estimated Scope
**Files changed:** 4 (`types.ts`, `create.ts`, `api.ts`, `lib.ts`)
**Files added:** 0
**Test files changed:** 2 (`create.test.ts`, `api.test.ts`)
**Lines of code (estimate):** ~120 implementation, ~200 tests

This is a contained change. The new code paths are small because they feed into existing machinery (preflight, worktree creation, rollback, state management) that already handles multi-repo.
