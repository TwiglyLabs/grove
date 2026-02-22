
## From plans
- **clean-library-api** — structured return values (no stdout side-effects), consistent typed results that the enhanced prune logic must conform to

## From existing code
- `src/environment/api.ts` — existing `prune()` implementation (namespace-only scope) to be extended
- Environment state management (active namespaces, service records)
- Workspace state management (workspace-to-environment mapping)
