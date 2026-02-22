
## Steps
### Define ClusterProvider Interface
1. Add `ClusterProvider` interface to `environment/types.ts` with methods covering create, delete, start, stop, and status operations.
2. Add provider-specific config types to `environment/types.ts`.

### Extract KindProvider
1. Create `environment/kind-provider.ts` implementing `ClusterProvider`.
2. Move existing kind-specific logic from `environment/api.ts` into `KindProvider`.
3. Ensure `KindProvider` wraps existing code without changing behavior.

### Update Environment API
1. Refactor `environment/api.ts` to accept a `ClusterProvider` (dependency injection or config-driven factory).
2. Remove hard-coded kind calls from API functions.

### Implement K3sProvider
1. Create `environment/k3s-provider.ts` implementing `ClusterProvider`.
2. Implement all interface methods with k3s-specific tooling.

### Config-Based Provider Selection
1. Add `provider` field to the environment config schema in `environment/types.ts`.
2. Register the updated schema in `src/config.ts`.
3. Implement a `createProvider(config)` factory function that returns the appropriate provider.

### Stub RemoteProvider
1. Create `environment/remote-provider.ts` with a stub implementation that throws `NotImplementedError` for all methods.

### Tests
1. Write unit tests using a `MockProvider` implementing `ClusterProvider`.
2. Verify environment API functions delegate correctly to the provider.
3. Verify `KindProvider` passes existing integration tests unchanged.

## Testing
- Environment operations (up, down, destroy, status) work correctly against a `MockProvider`.
- `KindProvider` wraps existing kind code without any behavior change; existing tests continue to pass.
- `K3sProvider` methods are callable and return the correct shape.
- Config-based provider selection instantiates the correct provider type.
- `npm run build` succeeds with no type errors.
- `npm test` passes with all tests green.

## Done-when
- `ClusterProvider` interface is defined in `environment/types.ts`.
- `KindProvider` is extracted and wraps all existing kind logic.
- `environment/api.ts` uses the provider interface, not hard-coded kind calls.
- `K3sProvider` is implemented and satisfies the interface.
- Config-based provider selection works end-to-end.
- `RemoteProvider` stub exists and satisfies the interface.
