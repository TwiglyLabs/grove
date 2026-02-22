
## Steps
### Create Test Fixture Project
1. Create a minimal `.grove.yaml` fixture under `test/fixtures/integration-project/`.
2. Include 2-3 services with distinct port requirements.

### Write Integration Test Script
1. Create `test/integration/lifecycle.test.ts`.
2. In the test, create 2-3 workspaces in parallel using `workspace.create()`.
3. Call `workspace.up()` on each workspace concurrently.
4. Call `describe()` on each workspace and verify the returned descriptor is complete.
5. Verify services are reachable on their allocated ports (HTTP probe or TCP connect).
6. Call `workspace.destroy()` on all workspaces.
7. Call `prune()` and verify clean state.

### Assert Isolation Properties
1. Assert each workspace has a unique Kubernetes namespace.
2. Assert no two workspaces share overlapping port ranges.

### Assert Clean Teardown
1. After destroy + prune, assert no leftover state files exist for the test workspaces.
2. Assert no leftover worktrees exist.
3. Assert allocated ports are released.

### npm Script
1. Add `"test:integration": "vitest run test/integration"` to `package.json`.

### Documentation
1. Add a `## Integration Tests` section to `CLAUDE.md` describing machine requirements (Docker, kind/k3s, available ports).

## Testing
- Full parallel workspace lifecycle (create, up, describe, destroy, prune) completes without errors.
- Port and namespace isolation is verified programmatically.
- State is fully clean after destroy + prune (no leftover files, worktrees, or port allocations).
- Tests are runnable via `npm run test:integration`.

## Done-when
- Integration test exercises full parallel provisioning of 2-3 workspaces.
- Unique namespaces and non-overlapping ports are verified for each workspace.
- Clean state after destroy + prune is verified.
- `npm run test:integration` script exists in `package.json` and runs the suite.
- Machine requirements are documented.
