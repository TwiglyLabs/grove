
## Config schema
`.grove.yaml` gains two new config sections validated by the root schema compositor (`src/config.ts`):

```yaml
setup:
  - npm install
  - npx prisma migrate deploy

hooks:
  postCreate: ./scripts/post-create.sh
  preUp: ./scripts/pre-up.sh
  postUp: ./scripts/post-up.sh
```

## Public API
`src/environment/api.ts` exports:
- `runSetupCommands(workspaceId: WorkspaceId, config: GroveConfig): Promise<SetupResult[]>` — runs each setup command in order, collects structured results, handles partial failures

Setup is wired into `workspace.create()`: after workspace creation, `runSetupCommands()` is called automatically.

Lifecycle hooks are executed at the appropriate `ensureEnvironment()` phases (`preUp`, `postUp`) and after `workspace.create()` (`postCreate`).

## Types
`src/environment/types.ts` exports:
- `SetupResult` — `{ command: string, exitCode: number, stdout: string, stderr: string, durationMs: number }`
- `HookResult` — same shape as `SetupResult`, used for lifecycle hook execution results
- `SetupFailedError extends GroveError` — thrown when a setup command exits non-zero (includes partial results for completed commands)

## Pattern established
Structured command execution with partial failure handling: each command result is collected regardless of prior failures, then `SetupFailedError` is thrown with the full `SetupResult[]` array attached. Downstream plans (concurrency-tests, environment-descriptor, integration-harness) can inspect per-command results to validate setup behavior under failure conditions.
