
## Steps
### Delete Source Directory
1. Delete the entire `src/request/` directory and all files within it.

### Remove from CLI
1. Open `src/cli.ts` and remove the import of `requestCommand` (or equivalent) from `src/request/cli.ts`.
2. Remove the registration of the request subcommand from the Commander program.

### Remove from Library API
1. Open `src/lib.ts` and remove the `request` namespace export.
2. Remove any request-related type re-exports from `src/lib.ts`.

### Verify Config
1. Open `src/config.ts` and confirm there is no request schema fragment being composed in.
2. Remove any such fragment if found.

### Verify Build
1. Run `npm run build` and confirm it succeeds with no type errors.

### Verify Tests
1. Run `npm test` and confirm all tests pass.
2. Search the codebase for any remaining references to the `request` slice and remove them.

## Testing
- `npm run build` succeeds with no type errors after deletion.
- `npm test` passes with all tests green after deletion.
- No references to `src/request/`, `requestCommand`, or the `request` namespace remain in the codebase.

## Done-when
- `src/request/` directory is deleted.
- `src/cli.ts` has no imports or registrations related to the request slice.
- `src/lib.ts` has no request namespace or request type exports.
- `src/config.ts` has no request schema fragment.
- `npm run build` passes.
- `npm test` passes.
