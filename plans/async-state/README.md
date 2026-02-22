---
title: Async State I/O for Electron Integration
status: not_started
description: >-
  Convert grove registry and workspace state I/O from sync to async, eliminating
  main thread blocking in Electron contexts.
tags:
  - 'epic:responsive-app'
  - cross-repo
type: feature
not_started_at: '2026-02-22T22:53:44.647Z'
---

## Problem
Grove's registry and workspace state management use synchronous file I/O (`readFileSync`, `writeFileSync`, `readdirSync`, `existsSync`, `statSync`, `unlinkSync`) inside async lock wrappers.

The pattern looks like:
```
await lockfile.lock(path)   // async lock acquisition
readFileSync(path)          // sync read — blocks event loop
writeFileSync(path, data)   // sync write — blocks event loop
release()                   // async release
```

While individual operations are fast (small JSON files), they accumulate:

| File | Sync calls | Called when |
|------|-----------|------------|
| `repo/state.ts` | `existsSync`(2), `mkdirSync`(1), `readFileSync`(1), `writeFileSync`(4) | Every repo add/remove/list |
| `workspace/state.ts` | `existsSync`(4), `mkdirSync`(1), `readFileSync`(2), `writeFileSync`(2), `unlinkSync`(2), `readdirSync`(1), `lockSync`(1) | Every workspace operation |
| `repo/api.ts` | `existsSync`(1), `realpathSync`(2) | repo.list(), repo.findByPath() |
| `repo/list.ts` | `existsSync`(1) | Building repo list entries |

In Canopy's startup, `grove:list-repos` calls `repo.list()` which reads the registry (sync) then checks `existsSync` per repo. With 5-10 repos, that's 10-20 sync I/O calls on the main thread.

More critically, `workspace/state.ts:deleteWorkspaceState()` uses **`lockfile.lockSync()`** — a synchronous lock that can spin-wait, which is especially dangerous in Electron.

**Signature impact:** Four `workspace/state.ts` exports are fully synchronous functions — `readWorkspaceState`, `deleteWorkspaceState`, `listWorkspaceStates`, `findWorkspaceByBranch`. These must become async, which ripples to ~10 caller modules.
## Approach
Convert the state layer to fully async I/O while keeping the lock-based concurrency model.

**Design principles:**

1. **Replace sync FS with `fs.promises.*`** — `readFile`, `writeFile`, `mkdir`, `readdir`, `stat`, `access`, `unlink`, `realpath`.
2. **Remove `lockSync`** — the one `lockfile.lockSync()` in `deleteWorkspaceState()` becomes `await lockfile.lock()`.
3. **Keep lock semantics** — `withRegistryLock()` already acquires locks async. The change is making the I/O inside the lock async too.
4. **Existing public API is mostly async** — `repo.add()`, `repo.list()`, `workspace.create()`, etc. already return Promises.
5. **Three public API functions change signature** — `workspace.readState()`, `workspace.resolvePath()`, `workspace.describe()` go from sync to async. Canopy callers of these 3 functions need `await`.
6. **Internal callers must update** — ~10 modules call the now-async workspace/state.ts functions. 6 of those are themselves sync and must cascade to async.

**What changes:**

| Layer | Before | After |
|-------|--------|-------|
| `repo/state.ts` internal helpers | `readFileSync`, `existsSync`, `mkdirSync` | `await readFile`, `await access`, `await mkdir` |
| `repo/state.ts` `withRegistryLock` | `writeFileSync` for init | `await writeFile` for init |
| `workspace/state.ts` exports | 4 sync functions | 4 async functions (signature change) |
| `workspace/state.ts` `deleteWorkspaceState` | `lockfile.lockSync()` | `await lockfile.lock()` |
| `workspace/api.ts` | 4 sync exports (`readState`, `resolvePath`, `describe`, `resolveWorkspace`) | async (PUBLIC API change for first 3) |
| `workspace/status.ts` | 3 sync exports (`listWorkspaces`, `getWorkspaceStatus`, `detectWorkspaceFromCwd`) | async |
| `workspace/preflight.ts` | `preflightCreate` sync | async |
| `repo/api.ts` | `existsSync`, `realpathSync` | `await access`, `await realpath` |
| `repo/list.ts` | `existsSync` | `await access` |

**Public API impact (Canopy must update):**
- `workspace.readState(id)` → returns `Promise<WorkspaceState | null>` (was sync)
- `workspace.resolvePath(id)` → returns `Promise<string>` (was sync)
- `workspace.describe(id)` → returns `Promise<EnvironmentDescriptor>` (was sync)
## Steps
### Chunk 1: Async registry state (`repo/state.ts`)

Self-contained — no public signature changes.

1. Change `import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'` → `import { readFile, writeFile, mkdir } from 'fs/promises'`.
2. `ensureRegistryDir()` → `async ensureRegistryDir()`: replace `existsSync` + `mkdirSync` with `await mkdir(dir, { recursive: true })` (mkdir recursive is a no-op if exists).
3. `readRegistryFromDisk()` → `async readRegistryFromDisk()`: replace `existsSync` with try/readFile/catch, `readFileSync` with `await readFile`.
4. `withRegistryLock()`: replace `writeFileSync(path, '{}', { flag: 'wx' })` with `await writeFile(path, '{}', { flag: 'wx' })`.
5. Update callers inside state.ts: `readRegistry()`, `addRepo()`, `removeRepo()` already async — just add `await` to helper calls.
6. Replace the 4 `writeFileSync` calls inside lock callbacks with `await writeFile`.
7. Tests: existing `state.test.ts` and `state.concurrency.test.ts` should pass unchanged (API already async).

### Chunk 2: Async workspace state + full caller cascade

This is the largest chunk — 4 state.ts signatures change, triggering a cascade through 6 more sync functions across 3 modules.

**Layer 1 — `workspace/state.ts` core (4 functions):**
1. `readWorkspaceState(id)` → `async`: Promise<WorkspaceState | null>
2. `writeWorkspaceState()` → async FS internally (already async signature)
3. `deleteWorkspaceState(id)` → `async`: Promise<void>, remove `lockSync`
4. `listWorkspaceStates()` → `async`: Promise<WorkspaceState[]>
5. `findWorkspaceByBranch(branch)` → `async`: calls await listWorkspaceStates()

**Layer 2 — sync callers that must become async (6 functions):**
- `workspace/api.ts:resolveWorkspace()` — private helper, calls readWorkspaceState + findWorkspaceByBranch
- `workspace/api.ts:readState()` — PUBLIC, calls internalReadState + findWorkspaceByBranch
- `workspace/api.ts:resolvePath()` — PUBLIC, calls resolveWorkspace
- `workspace/api.ts:describe()` — PUBLIC, calls resolveWorkspace
- `workspace/status.ts:listWorkspaces()` — exported, calls listWorkspaceStates
- `workspace/status.ts:getWorkspaceStatus()` — exported, calls readWorkspaceState + findWorkspaceByBranch + detectWorkspaceFromCwd
- `workspace/status.ts:detectWorkspaceFromCwd()` — private, calls listWorkspaceStates
- `workspace/preflight.ts:preflightCreate()` — exported, calls readWorkspaceState

**Layer 3 — already-async callers that just need `await` added:**
- `workspace/api.ts:sync()` — await resolveWorkspace()
- `workspace/api.ts:close()` — await resolveWorkspace()
- `workspace/cli.ts:handleList()` — await listWorkspaces()
- `workspace/cli.ts:handleStatus()` — await getWorkspaceStatus()
- `workspace/cli.ts:handleSwitch()` — await readWorkspaceState() + findWorkspaceByBranch()
- `workspace/sync.ts:syncWorkspace()` — await readWorkspaceState() + findWorkspaceByBranch()
- `workspace/close.ts:closeWorkspace()` — await readWorkspaceState() + findWorkspaceByBranch()
- `workspace/close.ts:closeMerge()` — await deleteWorkspaceState()
- `workspace/close.ts:closeDiscard()` — await deleteWorkspaceState()
- `workspace/create.ts:createWorkspace()` — await readWorkspaceState() + preflightCreate()
- `workspace/create.ts:cleanupFailed()` — await deleteWorkspaceState()
- `workspace/preflight.ts:preflightCreate()` — await readWorkspaceState()
- `repo/api.ts:list()` — await listWorkspaceStates()
- `repo/list.ts:listRepos()` — await listWorkspaceStates()

**Test updates (13 test files):**
- `workspace/state.test.ts` — add `await` to ~15 call sites
- `workspace/state.concurrency.test.ts` — add `await`, remove Promise wrappers around deleteWorkspaceState
- Mock-based tests: `mockReturnValue` → `mockResolvedValue` for all 4 state.ts functions + `listWorkspaces`, `getWorkspaceStatus`, `preflightCreate`, `resolveWorkspace`, `readState`, `resolvePath`, `describe`
- Affected: `api.test.ts`, `cli.test.ts`, `sync.test.ts`, `close.test.ts`, `create.test.ts`, `preflight.test.ts`, `status.test.ts`, `repo/api.test.ts`, `repo/list.test.ts`

### Chunk 3: Async FS in `repo/api.ts` + `repo/list.ts`

Sync FS calls in already-async functions.

1. `repo/api.ts`: Replace `import { existsSync, realpathSync } from 'fs'` → `import { access, realpath } from 'fs/promises'`.
2. `list()` line 91: `exists: existsSync(entry.path)` → use `Promise.all` on `.map()` with async callback.
3. `findByPath()` lines 106,113: `realpathSync(path)` → `await realpath(path)`. Refactor `.find()` to `for...of` loop (async callbacks don't work with `.find()`).
4. `repo/list.ts` line 37: same `Promise.all` pattern as repo/api.ts.
5. Tests: `api.test.ts` and `list.test.ts` should pass with minimal changes.
