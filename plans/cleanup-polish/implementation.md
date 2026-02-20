## Steps
### Delete old directories

1. Verify `src/api/events.ts` is empty or contains no remaining interfaces — if so, delete
2. Delete `src/api/` entirely (index.ts, types.ts, events.ts, and any remaining files)
3. Delete `src/commands/` entirely
4. Delete any remaining orphaned root files: `src/types.ts`, `src/sanitize.ts`, `src/timing.ts`, `src/template.ts`
5. Run tests to confirm nothing depends on deleted files

### Update public API entry point

6. Rewrite `src/index.ts` as the public API barrel — re-export all slices plus shared types/errors
7. Run tests

### Update package.json

8. Update `"exports"` field: point `"."` at `./dist/index.js` (not `./dist/api/index.js`)
9. Update `"main"` and `"types"` fields to match
10. Run `npm run build`
11. Verify canopy's `file:../grove` dependency resolves: `cd ../canopy && npx tsc --noEmit`

### Documentation

12. Update README to reflect vertical slice architecture, current command set, library API
13. Update project CLAUDE.md: freshness date, verify conventions match actual code

### Final verification

14. Run full test suite
15. Run build
16. Verify canopy typecheck
17. Manual smoke test: `grove --help`, `grove repo list`, `grove up --help`

## Testing
- All tests pass after removing old directories
- `npm run build` succeeds
- Canopy's typecheck passes: `cd ../canopy && npx tsc --noEmit`
- `grove --help` shows all commands
- `grove repo list`, `grove up --help` work correctly
- No orphaned imports or dead code remain

## Done-when
- `src/api/` directory deleted entirely
- `src/commands/` directory deleted entirely
- `src/types.ts`, `src/sanitize.ts`, `src/timing.ts`, `src/template.ts` deleted
- `src/api/events.ts` deleted (all event interfaces distributed to slices)
- `package.json` exports point at new locations
- README reflects vertical slice architecture
- CLAUDE.md freshness date updated, conventions match actual code
- Canopy integration verified (typecheck passes)
- All tests pass, build succeeds
