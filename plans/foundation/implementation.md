## Steps
### Phase 1 — Directory scaffolding

1. Create `src/shared/` directory
2. Create empty slice directories: `src/shell/`, `src/logs/`, `src/request/` (others already exist: `src/repo/`, `src/workspace/`, `src/environment/`, `src/testing/`, `src/simulator/`)
3. Verify all directories exist with correct names

### Phase 2 — Extract shared infrastructure

4. Move `src/api/identity.ts` → `src/shared/identity.ts`. Update all imports (grep for `'./identity'`, `'../api/identity'`)
5. Move `src/api/identity.test.ts` → `src/shared/identity.test.ts`
6. Move `src/api/errors.ts` → `src/shared/errors.ts`. Update all imports
7. Move `src/api/errors.test.ts` → `src/shared/errors.test.ts`
8. Move `src/output.ts` → `src/shared/output.ts`. Update all imports (grep for `'./output'`, `'../output'`)
9. Move `src/output.test.ts` → `src/shared/output.test.ts`
10. Move `src/api/config.ts` → `src/shared/config.ts`. Update all imports (grep for `'./config'` in api/, `'../api/config'`)
11. Move `src/api/config.test.ts` → `src/shared/config.test.ts`
12. Run tests — all must pass

### Phase 3 — Config compositor pattern

13. Refactor `src/config.ts`: keep as root parser, but add comments marking which schema fragments will move to which slice
14. Export schema fragments individually (not just the composed `GroveConfigSchema`) so slices can import them during migration
15. Run tests — all must pass

### Phase 4 — Commander CLI skeleton

16. `npm install commander`
17. Create `src/cli.ts` with commander `program` setup: version, description, global options
18. Register all existing commands as commander subcommands delegating to current command functions
19. Move `resolveCurrentRepo()` from `src/index.ts` to `src/cli.ts` as shared CLI utility
20. Refactor `src/index.ts` to use commander program instead of the switch statement
21. Run tests — all must pass
22. Manual smoke test: `grove --help`, `grove repo list`, `grove --version`

### Phase 5 — CLAUDE.md

23. Write project-level `CLAUDE.md` documenting: vertical slice architecture, directory conventions, development commands (`npm test`, `npm run build`), testing approach (vitest, colocated tests), quality gates, and the pattern for adding new slices

## Testing
- All 535 existing tests pass after each phase (no behavioral changes)
- `grove --help` shows commander-formatted help with all subcommands
- `grove repo list` works through the new commander dispatch
- `grove --version` prints the correct version
- Imports from `src/shared/` resolve correctly (identity, errors, output, config)

## Done-when
- `src/shared/` contains identity.ts, errors.ts, output.ts, config.ts with all imports updated
- Commander CLI skeleton in `src/cli.ts` dispatches to all existing commands
- `src/index.ts` uses commander instead of the switch statement
- Config compositor pattern is established in `src/config.ts` with individually-exported schema fragments
- All slice directories exist (empty, ready for migration)
- Project CLAUDE.md exists documenting architecture and conventions
- All tests pass, build succeeds
