## Steps


## Testing


## Done-when
- All 4 chunks implemented and tested
- `npm test` passes, `npm run build` succeeds
- `PortForwardProcess.start()` and `GenericDevServer.start()` close FDs on all failure paths
- `child.pid` undefined is handled with a typed error (no `process.kill(0)` risk)
- `PortForwardSupervisor.stop()` is async and drains in-flight `checkAll`
- `attemptRecovery()` bails when `running === false`
- `down()` awaits supervisor stop before killing processes
- `up()` stops previous supervisor before creating a new one
- Signal handler registered on `up()`, cleaned on `down()`
- PID validation includes process-name check (best-effort)
- No regressions in existing tests
