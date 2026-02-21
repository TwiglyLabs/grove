## Steps


## Testing


## Done-when
- All 4 chunks implemented and tested
- `npm test` passes, `npm run build` succeeds
- `new BuildFailedError('x') instanceof GroveError` returns `true` (prototype chain fixed)
- `new BuildFailedError('x') instanceof BuildFailedError` returns `true`
- `EnvironmentState`, `ProcessInfo` importable from `@twiglylabs/grove`
- `PortForwardSupervisor` emits `gaveUp` after exactly `maxRecoveryAttempts` failures (not +1)
- `PreflightFailedError` and `PortForwardFailedError` have test coverage in `errors.test.ts`
- No regressions in existing tests
