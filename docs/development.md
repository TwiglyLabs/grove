# Development

## Prerequisites

- Node.js 22+
- npm
- TypeScript 5.6+

## Setup

```bash
cd grove
npm install
npm run build
npm link        # makes `grove` available globally on your PATH
```

## Build

```bash
npm run build   # TypeScript compile to dist/
npm run lint    # type-check without emit (tsc --noEmit)
npm run dev     # watch mode compile
```

The build output is `dist/`. The CLI entry point is `dist/index.js`; the library entry point is `dist/lib.js`.

## Testing

Grove uses [Vitest](https://vitest.dev/) with tests colocated next to source files (`*.test.ts`).

```bash
npm test              # run all unit tests
npm run test:watch    # watch mode
npm run test:e2e      # end-to-end tests (requires a running cluster)
npm run test:integration   # integration tests
npm run test:smoke    # smoke tests
```

Test configuration files:

| File | Scope |
|------|-------|
| `vitest.config.ts` | Unit tests (default) |
| `vitest.e2e.config.ts` | End-to-end tests |
| `vitest.integration.config.ts` | Integration tests |
| `vitest.smoke.config.ts` | Smoke tests |

Coverage is provided by the v8 provider configured in `vitest.config.ts`.

## Quality Gates

All of the following must pass before committing:

- `npm run build` — no TypeScript errors
- `npm test` — all unit tests green
- No `any` types without a justification comment
- Branded types (`RepoId`, `WorkspaceId`) for domain identifiers — do not use raw strings

## Adding a New Slice

Slices are the unit of organization in Grove. Each domain gets its own directory under `src/`.

1. **Create the directory:** `src/<domain>/`

2. **Add `types.ts`** with domain types and zod schemas:
   ```typescript
   import { z } from 'zod';

   export const MyThingSchema = z.object({ ... });
   export type MyThing = z.infer<typeof MyThingSchema>;
   ```

3. **Add `config.ts`** if the slice owns config fields, then register the schema fragment in `src/config.ts`:
   ```typescript
   // src/config.ts
   import { MyThingSchema } from './mydomain/config.js';

   export const GroveConfigSchema = z.object({
     ...
     myThing: MyThingSchema.optional(),
   });
   ```

4. **Add `api.ts`** with public async functions. Accept `RepoId` or `WorkspaceId` — never raw paths:
   ```typescript
   import type { RepoId } from '../shared/identity.js';

   export async function doSomething(repoId: RepoId): Promise<Result> { ... }
   ```

5. **Add `cli.ts`** with command registration. Export a function that registers subcommands. Use shared output helpers:
   ```typescript
   import { printSuccess, printError } from '../shared/output.js';

   export async function myDomainCommand(repoId: RepoId, args: string[]): Promise<void> { ... }
   ```

6. **Register commands in `src/cli.ts`:**
   ```typescript
   import { myDomainCommand } from './mydomain/cli.js';

   program
     .command('mything')
     .description('Do something with my thing')
     .action(async () => {
       const repoId = await resolveCurrentRepo();
       await myDomainCommand(repoId, []);
     });
   ```

7. **Re-export from `src/lib.ts`:**
   ```typescript
   export * as myDomain from './mydomain/api.js';
   export type { MyThing } from './mydomain/types.js';
   ```

8. **Write colocated tests:** `src/<domain>/*.test.ts`

## Error Handling

All library errors extend `GroveError` from `src/shared/errors.ts`:

```typescript
import { GroveError } from '../shared/errors.js';

export class MyDomainError extends GroveError {
  constructor(message: string) {
    super('MY_DOMAIN_ERROR', message);
  }
}
```

CLI commands catch errors and call `handleError()` (in `src/cli.ts`) which prints the message and exits with code 1. Library consumers can match on `error.code` for programmatic handling.

## Repository Layout

```
grove/
  src/                Source code (TypeScript/ESM)
  dist/               Build output (git-ignored)
  test/               Test fixtures and helpers
  docs/               Documentation
  plans/              Trellis plan files
  package.json
  tsconfig.json
  vitest.config.ts
  CLAUDE.md           Architecture reference for AI agents
  README.md
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GROVE_WORKTREE_DIR` | `~/worktrees/` | Base directory for workspace worktrees |
| `GROVE_STATE_DIR` | `~/.grove/workspaces/` | Directory for workspace state files |
