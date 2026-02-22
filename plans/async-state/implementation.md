## Steps
### Chunk 1: `repo/state.ts`

**Files:** `src/repo/state.ts`

```
1. Replace fs import:
   - import { readFile, writeFile, mkdir } from 'fs/promises';
   - Remove existsSync, mkdirSync, readFileSync, writeFileSync imports

2. ensureRegistryDir() → async:
   - async function ensureRegistryDir(): Promise<string>
   - Body: await mkdir(dir, { recursive: true }); return dir;
   - (mkdir recursive is idempotent — no need for exists check)

3. readRegistryFromDisk() → async:
   - async function readRegistryFromDisk(): Promise<RepoRegistry>
   - Replace existsSync + readFileSync with:
     try { const content = await readFile(filePath, 'utf-8'); ... }
     catch { return emptyRegistry(); }
   - The try/catch handles both file-not-found and parse errors

4. withRegistryLock():
   - await ensureRegistryDir() (now async)
   - Replace writeFileSync(path, '{}', { flag: 'wx' }) with await writeFile(path, '{}', { flag: 'wx' })
   - fn callback type stays () => T | Promise<T> — no change

5. readRegistry():
   - const registry = await readRegistryFromDisk(); (now async)
   - Inside lock callback: const fresh = await readRegistryFromDisk();
   - Replace writeFileSync with await writeFile

6. addRepo():
   - Inside lock callback: const registry = await readRegistryFromDisk();
   - Replace writeFileSync with await writeFile

7. removeRepo():
   - Inside lock callback: const registry = await readRegistryFromDisk();
   - Replace writeFileSync with await writeFile
```

**Verify:** `npm test -- src/repo/state.test.ts src/repo/state.concurrency.test.ts`

---

### Chunk 2: `workspace/state.ts` + full cascade

**Source files changed (10):**
- `src/workspace/state.ts` (core)
- `src/workspace/api.ts` (4 functions go async + await added)
- `src/workspace/cli.ts` (3 handlers add await)
- `src/workspace/sync.ts` (add await)
- `src/workspace/status.ts` (3 functions go async)
- `src/workspace/preflight.ts` (preflightCreate goes async)
- `src/workspace/close.ts` (add await)
- `src/workspace/create.ts` (add await)
- `src/repo/api.ts` (add await to listWorkspaceStates call)
- `src/repo/list.ts` (add await to listWorkspaceStates call)

**Test files changed (11):**
- `src/workspace/state.test.ts`
- `src/workspace/state.concurrency.test.ts`
- `src/workspace/api.test.ts`
- `src/workspace/cli.test.ts`
- `src/workspace/sync.test.ts`
- `src/workspace/close.test.ts`
- `src/workspace/create.test.ts`
- `src/workspace/preflight.test.ts`
- `src/workspace/status.test.ts`
- `src/repo/api.test.ts`
- `src/repo/list.test.ts`

```
Core workspace/state.ts:
1. Replace fs import → fs/promises (readFile, writeFile, mkdir, access, unlink, readdir)
2. Remove LOCK_OPTIONS_SYNC constant
3. ensureStateDir() → async: await mkdir(dir, { recursive: true })
4. Split stateFilePath(id) into:
   - stateFilePath(id): string — pure path computation (sync)
   - Call ensureStateDir() separately where needed
5. readWorkspaceState → async:
   try { const content = await readFile(filePath, 'utf-8'); ... }
   catch { return null; }
6. writeWorkspaceState: await ensureStateDir(), await writeFile for init + write
7. deleteWorkspaceState → async:
   - try { await access(filePath) } catch { return } // replaces existsSync
   - const release = await lockfile.lock(filePath, LOCK_OPTIONS) // replaces lockSync
   - await unlink(filePath) // replaces unlinkSync
   - Error recovery: try { await access(filePath); await unlink(filePath) } catch {}
8. listWorkspaceStates → async:
   - await ensureStateDir()
   - const files = await readdir(dir)
   - await readFile per file (or Promise.all for parallel reads)
9. findWorkspaceByBranch → async: const states = await listWorkspaceStates()

Layer 2 — sync functions that must become async:
- workspace/api.ts:resolveWorkspace() → async: await internalReadState + await findWorkspaceByBranch
- workspace/api.ts:readState() → async: await internalReadState + await findWorkspaceByBranch
- workspace/api.ts:resolvePath() → async: await resolveWorkspace
- workspace/api.ts:describe() → async: await resolveWorkspace
- workspace/status.ts:listWorkspaces() → async: const states = await listWorkspaceStates(); return states.map(...)
- workspace/status.ts:getWorkspaceStatus() → async: await readWorkspaceState + await findWorkspaceByBranch + await detectWorkspaceFromCwd
- workspace/status.ts:detectWorkspaceFromCwd() → async: const states = await listWorkspaceStates()
- workspace/preflight.ts:preflightCreate() → async: await readWorkspaceState

Layer 3 — already-async callers, just add await:
- workspace/api.ts:sync() L129 — await resolveWorkspace(workspace)
- workspace/api.ts:close() L154 — await resolveWorkspace(workspace)
- workspace/cli.ts:handleList() L102 — await listWorkspaces()
- workspace/cli.ts:handleStatus() L125 — await getWorkspaceStatus(...)
- workspace/cli.ts:handleSwitch() L223 — await readWorkspaceState + await findWorkspaceByBranch
- workspace/sync.ts:syncWorkspace() L16 — await readWorkspaceState + await findWorkspaceByBranch
- workspace/close.ts:closeWorkspace() L23 — await readWorkspaceState + await findWorkspaceByBranch
- workspace/close.ts:closeMerge() L143 — await deleteWorkspaceState
- workspace/close.ts:closeDiscard() L182 — await deleteWorkspaceState
- workspace/create.ts:createWorkspace() L33,68 — await readWorkspaceState, await preflightCreate
- workspace/create.ts:cleanupFailed() L219 — await deleteWorkspaceState
- repo/api.ts:list() L79 — await listWorkspaceStates()
- repo/list.ts:listRepos() L26 — await listWorkspaceStates()

Test mock updates:
- All vi.fn() mocks: mockReturnValue → mockResolvedValue for affected functions
- state.test.ts: add await to ~15 call sites
- state.concurrency.test.ts: remove Promise wrappers, use await deleteWorkspaceState directly
- api.test.ts: mockResolvedValue for resolveWorkspace, readState, resolvePath, describe mocks
- status.test.ts: mockResolvedValue for listWorkspaces, getWorkspaceStatus; add await to test calls
- preflight.test.ts: add await to preflightCreate calls
```

**Verify:** `npm run build && npm test` (full suite — many files touched)

---

### Chunk 3: Async FS in `repo/api.ts` + `repo/list.ts`

**Files:** `src/repo/api.ts`, `src/repo/list.ts`

```
repo/api.ts:
1. Replace import { existsSync, realpathSync } from 'fs'
   → import { access, realpath } from 'fs/promises'
2. list(): sync .map() → async Promise.all:
   return Promise.all(registry.repos.slice().sort(...).map(async entry => {
     const exists = await access(entry.path).then(() => true, () => false);
     const matching = workspaces.filter(ws => ws.source === entry.path);
     return { ...entry, exists, workspaceCount: matching.length };
   }))
3. findByPath(): realpathSync → await realpath
   - resolvedPath = await realpath(path).catch(() => path)
   - Refactor .find() to for...of loop:
     for (const r of registry.repos) {
       const rPath = await realpath(r.path).catch(() => r.path);
       if (rPath === resolvedPath) { found = r; break; }
     }

repo/list.ts:
1. Replace import { existsSync } from 'fs' → import { access } from 'fs/promises'
2. listRepos(): Same Promise.all pattern
```

**Verify:** `npm test -- src/repo/api.test.ts src/repo/list.test.ts`
## Testing
### Test strategy

All existing tests use **real filesystem** operations (no fs mocking) via `os.homedir()` override pointing to a temp directory. This means:

- Switching from sync to async FS calls should be transparent to the test infrastructure
- The main test changes are adding `await` to calls that become async
- Mock-based tests (in api.test.ts, cli.test.ts, etc.) need `mockResolvedValue` instead of `mockReturnValue`

### Test change inventory

| Test file | Changes needed |
|-----------|---------------|
| `repo/state.test.ts` | None — API was already async |
| `repo/state.concurrency.test.ts` | None — API was already async |
| `workspace/state.test.ts` | Add `await` to 4 function calls (~15 call sites) |
| `workspace/state.concurrency.test.ts` | Add `await`, remove Promise wrappers around deleteWorkspaceState |
| `workspace/api.test.ts` | `mockReturnValue` → `mockResolvedValue` for readWorkspaceState, findWorkspaceByBranch, deleteWorkspaceState |
| `workspace/cli.test.ts` | `mockReturnValue` → `mockResolvedValue` for readWorkspaceState, findWorkspaceByBranch |
| `workspace/sync.test.ts` | `mockReturnValue` → `mockResolvedValue` for readWorkspaceState, findWorkspaceByBranch |
| `workspace/close.test.ts` | `mockReturnValue` → `mockResolvedValue` for readWorkspaceState, findWorkspaceByBranch, deleteWorkspaceState |
| `workspace/create.test.ts` | `mockReturnValue` → `mockResolvedValue` for readWorkspaceState, deleteWorkspaceState |
| `workspace/preflight.test.ts` | `mockReturnValue` → `mockResolvedValue` for readWorkspaceState |
| `workspace/status.test.ts` | `mockReturnValue` → `mockResolvedValue` for listWorkspaceStates, readWorkspaceState, findWorkspaceByBranch |
| `repo/api.test.ts` | `mockReturnValue` → `mockResolvedValue` for listWorkspaceStates (if mocked) |
| `repo/list.test.ts` | May need mock updates if listWorkspaceStates is mocked |

### Verification sequence

1. After chunk 1: `npm test -- src/repo/state` (scoped)
2. After chunk 2: `npm test` (full suite — many files touched)
3. After chunk 3: `npm test` (full suite)
4. Final: `npm run build && npm test` (type-check + test)
## Done-when
- [ ] Zero `readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`, `readdirSync`, `unlinkSync`, `realpathSync` in `src/repo/state.ts`, `src/workspace/state.ts`, `src/repo/api.ts`, `src/repo/list.ts`
- [ ] Zero `lockSync` calls anywhere in the codebase
- [ ] Zero `import ... from 'fs'` in the 4 target files (all use `fs/promises`)
- [ ] `npm run build` succeeds (no type errors)
- [ ] `npm test` passes (all tests green)
- [ ] No new `any` types introduced
