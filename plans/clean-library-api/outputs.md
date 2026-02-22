
## Public API
All `src/*/api.ts` files return structured data instead of printing to stdout:
- `up(...)` returns `UpResult` — structured result with status, services started, errors
- `down(...)` returns `DownResult` — structured result with services stopped
- `status(...)` returns `StatusResult` — structured result with environment state
- All other api.ts functions return typed values, never `void` where data exists

## Types
`src/environment/types.ts` exports:
- `UpResult` — result of bringing an environment up, includes service states and errors
- `DownResult` — result of taking an environment down
- `StatusResult` — snapshot of environment state

All result types are exported from `src/lib.ts` for consumer use.

## Pattern established
Clean separation between library API and CLI presentation layer:
- `api.ts` functions are pure data-in / data-out — no `console.log`, no chalk, no process.exit
- `cli.ts` files own all user-facing formatting via `src/shared/output.ts` helpers
- `lib.ts` re-exports all public types and API namespaces for programmatic consumers
- Downstream plans (cluster-abstraction, enhanced-pruning, setup-automation) can call api.ts functions and receive structured results to compose further logic
