
## Steps
### Define EnvironmentDescriptor Type
1. Add `EnvironmentDescriptor` interface to `workspace/types.ts`.
2. Include fields: workspace info (id, name, status), service list, frontend list, testing commands, and shell targets.

### Implement describe()
1. Add `describe(workspaceId: WorkspaceId): Promise<EnvironmentDescriptor>` to `workspace/api.ts`.
2. Read workspace state from the state file.
3. Read environment state for each service from `environment` slice state.
4. Read the workspace config (`.grove.yaml`) for service and frontend definitions.
5. Compose the service list with name, status, ports, and image info.
6. Compose the frontend list with name, URL, and status.
7. Compose testing commands from config.
8. Compose shell targets from running pods.

### Export from lib.ts
1. Add `EnvironmentDescriptor` to the re-exports in `src/lib.ts`.
2. Ensure `describe` is accessible via the workspace namespace in `lib.ts`.

### Add CLI Subcommand
1. Add `grove workspace describe <workspace-id>` to `workspace/cli.ts`.
2. Call `describe()` and render the result using `shared/output.ts` helpers.

### Tests
1. Write unit tests for `describe()` with mocked state files and config.
2. Verify all fields of `EnvironmentDescriptor` are populated correctly.

## Testing
- `EnvironmentDescriptor` contains workspace info, services with ports and status, frontends with URLs, testing commands, and shell targets.
- CLI command `grove workspace describe` renders the descriptor without errors.
- Unit tests use mocked state and config, not live cluster access.
- `npm run build` succeeds with no type errors.
- `npm test` passes with all tests green.

## Done-when
- `describe()` returns a complete, well-typed `EnvironmentDescriptor`.
- `EnvironmentDescriptor` and `describe` are exported from `src/lib.ts`.
- `grove workspace describe` CLI subcommand is registered and works.
- Tests verify all fields of the descriptor are populated correctly.
