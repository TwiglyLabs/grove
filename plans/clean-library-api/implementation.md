
## Steps
### Audit
1. Audit all `api.ts` files for stdout side effects (imports of `shared/output.ts`, direct `console.log` calls).
2. List every API function and document its current return type.

### Define Return Types
1. Define `UpResult` type in `environment/types.ts`.
2. Define `StatusResult` type in `environment/types.ts`.
3. Add any additional structured result types needed by other slices.

### Refactor environment/api.ts
1. Remove all imports of `shared/output.ts` from `environment/api.ts`.
2. Update each function to return structured data instead of printing.
3. Ensure callers in `environment/cli.ts` handle formatting.

### Refactor workspace/api.ts
1. Remove all imports of `shared/output.ts` from `workspace/api.ts`.
2. Update each function to return structured data.
3. Ensure callers in `workspace/cli.ts` handle formatting.

### Refactor Remaining Slices
1. Repeat the same audit-and-refactor for `repo/api.ts`, `testing/api.ts`, `simulator/api.ts`, `shell/api.ts`, and `logs/api.ts`.
2. Move any formatting logic into the corresponding `cli.ts` files.

### Verify Exports
1. Confirm all new result types are re-exported from `src/lib.ts`.
2. Update `src/lib.ts` re-exports as needed.

### Lint Rule
1. Add an ESLint rule (or custom check) that prevents `api.ts` files from importing `shared/output.ts`.
2. Document the rule in `CLAUDE.md` quality gates.

## Testing
- All API functions return structured typed data, not `void` or `undefined`.
- No `api.ts` file imports `shared/output.ts` or calls `console.log`.
- CLI commands still render output correctly after refactor.
- `npm run build` succeeds with no type errors.
- `npm test` passes with all tests green.

## Done-when
- Zero stdout side effects in any `api.ts` file.
- All API functions return typed result objects.
- CLI layer (`cli.ts` files) handles all user-facing formatting.
- Lint rule is in place and prevents future regressions.
- `lib.ts` re-exports all new result types.
