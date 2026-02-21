## Steps


## Testing


## Done-when
- All 4 chunks implemented and tested
- `npm test` passes, `npm run build` succeeds
- `preflight.ts` `execSync` calls have `timeout` option
- `git branch --show-current` and `git rev-parse --show-toplevel` calls have `timeout` option
- `PortForwardSchema` rejects `remotePort: 0`, `remotePort: 99999`, and non-integer ports
- `PortForwardSchema` rejects malformed `hostIp` values
- `ConfigValidationError` message includes Zod field paths
- `GenericDevServer.start()` detects immediately-dead child process
- `GenericDevServer.start()` handles quoted arguments in commands
- No regressions in existing tests
