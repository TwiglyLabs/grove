## Steps


## Testing
### Unit tests: `src/environment/preflight.test.ts`

Mock `child_process.execSync` and `net.createServer` to test each check in isolation.

**Test cases:**
- `checkContainerRuntime()` passes when `docker info` succeeds
- `checkContainerRuntime()` fails with detail suggesting `colima start` when `docker info` fails
- `checkCommand()` passes when `which <cmd>` succeeds
- `checkCommand()` fails with clear message when command not found
- `checkClusterReachable()` passes when `kubectl cluster-info` succeeds within timeout
- `checkClusterReachable()` fails when cluster unreachable
- `checkPortAvailable()` returns true for free port, false for bound port
- `runPreflightChecks()` throws `PreflightFailedError` with all results when any check fails
- `runPreflightChecks()` fails fast on container runtime failure (does not check kubectl etc.)
- `runPreflightChecks()` selects correct provider command based on `config.project.clusterType`
## Done-when


## Design
### New types in `src/environment/types.ts`

```typescript
export type PreflightCheckName =
  | 'container-runtime'
  | 'kubectl'
  | 'helm'
  | 'cluster-provider'  // kind or k3d depending on config
  | 'cluster-reachable'
  | 'ports-available';

export interface PreflightResult {
  check: PreflightCheckName;
  passed: boolean;
  message: string;       // human-readable (e.g. "docker daemon is running")
  detail?: string;       // extra context on failure (e.g. "run 'colima start'")
}
```

### New error in `src/shared/errors.ts`

```typescript
export class PreflightFailedError extends GroveError {
  constructor(public results: PreflightResult[]) {
    const failed = results.filter(r => !r.passed);
    const summary = failed.map(r => r.message).join('; ');
    super('PREFLIGHT_FAILED', `Preflight checks failed: ${summary}`);
  }
}
```

### `src/environment/preflight.ts` structure

```typescript
import { execSync } from 'child_process';
import { createServer } from 'net';
import type { GroveConfig } from '../config.js';
import type { PreflightResult, PreflightCheckName } from './types.js';
import { PreflightFailedError } from '../shared/errors.js';

function checkContainerRuntime(): PreflightResult { /* docker info */ }
function checkCommand(cmd: string, name: PreflightCheckName): PreflightResult { /* which + version */ }
function checkClusterReachable(): PreflightResult { /* kubectl cluster-info */ }
async function checkPortAvailable(port: number): Promise<boolean> { /* net.createServer bind test */ }
async function checkPortsAvailable(ports: number[]): Promise<PreflightResult> { /* check all allocated ports */ }

export async function runPreflightChecks(config: GroveConfig): Promise<PreflightResult[]> {
  const results: PreflightResult[] = [];
  
  // 1. Container runtime (everything else depends on this)
  results.push(checkContainerRuntime());
  if (!results[0].passed) {
    throw new PreflightFailedError(results); // fail fast
  }
  
  // 2. CLI tools
  results.push(checkCommand('kubectl', 'kubectl'));
  results.push(checkCommand('helm', 'helm'));
  const providerCmd = config.project.clusterType === 'k3s' ? 'k3d' : 'kind';
  results.push(checkCommand(providerCmd, 'cluster-provider'));
  
  // 3. Cluster reachable (only if CLI tools are present)
  if (results.every(r => r.passed)) {
    results.push(checkClusterReachable());
  }
  
  // 4. Port availability (check configured ports if state exists)
  // Note: this is optional -- ports may not be allocated yet on first run
  
  const failed = results.filter(r => !r.passed);
  if (failed.length > 0) {
    throw new PreflightFailedError(results);
  }
  
  return results;
}
```

### Integration point in `controller.ts`

```typescript
// In ensureEnvironment(), before bootstrap:
import { runPreflightChecks } from './preflight.js';

export async function ensureEnvironment(config, options) {
  const timer = new Timer();
  
  printSection('Preflight Checks');          // NEW
  await runPreflightChecks(config);           // NEW
  
  const provider = createClusterProvider(config.project.clusterType);
  printSection('Ensuring Cluster');
  ensureCluster(provider, config.project.cluster);
  // ... rest unchanged
}
```

## Files
| File | Action | Description |
|------|--------|-------------|
| `src/environment/preflight.ts` | Create | Preflight check functions and orchestrator |
| `src/environment/preflight.test.ts` | Create | Unit tests with mocked system calls |
| `src/environment/types.ts` | Modify | Add `PreflightCheckName`, `PreflightResult` types |
| `src/shared/errors.ts` | Modify | Add `PreflightFailedError` class |
| `src/environment/controller.ts` | Modify | Call `runPreflightChecks()` before bootstrap |
| `src/lib.ts` | Modify | Re-export `PreflightFailedError` |
