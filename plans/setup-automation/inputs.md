
## From plans
- **clean-library-api** — `workspace.create()` returns structured data (typed result object, no stdout), enabling setup-automation to consume the created workspace details programmatically

## From existing code
- `src/workspace/types.ts` — workspace domain types and zod schemas
- `src/workspace/api.ts` — workspace API (`create`, `destroy`, lifecycle hooks)
- `src/shared/config.ts` — `.grove.yaml` config loader (setup hooks config shape)
