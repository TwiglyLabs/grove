
## Summary
All sync FS I/O in Grove's state layer has been converted to async `fs/promises` operations.

### What Changed

**4 target files converted:**
- `repo/state.ts` — `readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync` → `readFile`, `writeFile`, `mkdir` from `fs/promises`
- `workspace/state.ts` — all sync FS + `lockfile.lockSync()` → async equivalents
- `repo/api.ts` — `existsSync`, `realpathSync` → `access`, `realpath` from `fs/promises`
- `repo/list.ts` — `existsSync` → `access` from `fs/promises`

**Public API signature changes (Canopy must update):**
- `workspace.readState(id)` → now returns `Promise<WorkspaceState | null>`
- `workspace.resolvePath(id)` → now returns `Promise<string>`
- `workspace.describe(id)` → now returns `Promise<EnvironmentDescriptor>`

**Caller cascade updated (~10 modules):**
- `workspace/api.ts`, `workspace/status.ts`, `workspace/preflight.ts`, `workspace/cli.ts`, `workspace/sync.ts`, `workspace/close.ts`, `workspace/create.ts`, `repo/api.ts`, `repo/list.ts`, `environment/api.ts`

### Verification
- `npm run build` — clean (no type errors)
- `npm test` — 969 tests passing across 66 files
- Zero sync FS calls remain in target files

## Artifacts
No new files created. All changes are in-place conversions of existing source files.
