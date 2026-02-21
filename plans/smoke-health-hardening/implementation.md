## Steps


## Testing
### Unit tests to add/modify

**`src/environment/health.test.ts`** (new or extend existing):
- `waitForHealth()` returns `HealthCheckResult` with `healthy: true`, correct attempts count
- `waitForHealth()` returns `HealthCheckResult` with `healthy: false` after max attempts, includes error
- `waitForHealth()` elapsed time is approximately correct
- `checkHealth()` still returns boolean (backward compat)

**`src/environment/processes/PortForwardProcess.test.ts`** (new):
- `start()` verifies port is bound before returning
- `start()` throws `PortForwardFailedError` when port never binds
- `start()` cleans up zombie process on failure

**`src/environment/controller.test.ts`** (modify):
- `healthCheckAll()` returns array of `HealthCheckResult`
- `ensureEnvironment()` with `strict: true` throws when health check fails
- `ensureEnvironment()` without strict continues on health check failure (backward compat)
- `UpResult` includes health results

**`src/environment/config.test.ts`** (modify):
- `HealthCheckSchema` accepts `readinessPath`
- `HealthCheckSchema` still works without `readinessPath`
## Done-when


## Design
### New type: `HealthCheckResult`

```typescript
// In src/environment/types.ts
export interface HealthCheckResult {
  target: string;          // service or frontend name
  healthy: boolean;
  protocol: 'http' | 'tcp';
  host: string;
  port: number;
  path?: string;
  attempts: number;        // how many attempts before success/timeout
  elapsedMs: number;       // total time spent checking
  error?: string;          // error message on failure
}
```

### Modified `waitForHealth()` signature

```typescript
// In src/environment/health.ts
// Old: returns Promise<boolean>
// New: returns Promise<HealthCheckResult>
export async function waitForHealth(
  protocol: 'http' | 'tcp',
  host: string,
  port: number,
  path?: string,
  maxAttempts: number = 30,
  intervalMs: number = 1000,
  target: string = 'unknown',
): Promise<HealthCheckResult> {
  const start = Date.now();
  let attempts = 0;
  
  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    const healthy = await checkHealth(protocol, host, port, path);
    if (healthy) {
      return {
        target,
        healthy: true,
        protocol, host, port, path,
        attempts,
        elapsedMs: Date.now() - start,
      };
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return {
    target,
    healthy: false,
    protocol, host, port, path,
    attempts,
    elapsedMs: Date.now() - start,
    error: `Health check timed out after ${maxAttempts} attempts`,
  };
}
```

**Backward compatibility**: `checkHealth()` remains unchanged (returns boolean). Only `waitForHealth()` changes its return type. Since `waitForHealth()` is only called in `controller.ts`, the blast radius is small.

### Port-forward verification

```typescript
// In PortForwardProcess.ts, modify start():
async start(logsDir: string): Promise<ProcessInfo> {
  // ... spawn kubectl as before ...
  
  // Verify port actually bound (replaces bare 1000ms sleep)
  const maxWait = 5000;
  const interval = 500;
  let elapsed = 0;
  
  while (elapsed < maxWait) {
    await new Promise(resolve => setTimeout(resolve, interval));
    elapsed += interval;
    
    const bound = await checkTcpHealth('127.0.0.1', this.config.localPort);
    if (bound) {
      return { pid: child.pid!, startedAt: new Date().toISOString() };
    }
  }
  
  // Port never bound -- kill the zombie process and throw
  try { process.kill(child.pid!, 'SIGTERM'); } catch {}
  throw new PortForwardFailedError(
    this.config.serviceName,
    this.config.localPort,
  );
}
```

### Modified `healthCheckAll()` and strict mode

```typescript
// In controller.ts
async function healthCheckAll(
  config: GroveConfig,
  state: EnvironmentState,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  
  for (const service of config.services) {
    if (!service.health || !service.portForward) continue;
    const port = state.ports[service.name];
    const result = await waitForHealth(
      service.health.protocol || 'http',
      '127.0.0.1',
      port,
      service.health.path || '/',
      30, 1000,
      service.name,
    );
    results.push(result);
    if (result.healthy) printSuccess(`${service.name} is healthy`);
    else printError(`${service.name} health check failed`);
  }
  
  // ... same for frontends ...
  return results;
}

// In ensureEnvironment():
const healthResults = await healthCheckAll(config, state);

if (options.strict) {
  const failures = healthResults.filter(r => !r.healthy);
  if (failures.length > 0) {
    throw new HealthCheckFailedError(
      failures.map(f => f.target).join(', '),
    );
  }
}

// Include in state/result
return { state, healthResults };
```

### Readiness path extension

```typescript
// In src/environment/config.ts
export const HealthCheckSchema = z.object({
  path: z.string().optional(),
  protocol: z.enum(['http', 'tcp']).default('http'),
  readinessPath: z.string().optional(), // NEW: must return 200
});
```

When `readinessPath` is set, after the basic health check passes, a second check runs against the readiness path with `code === 200` (not the 200-499 range).

## Files
| File | Action | Description |
|------|--------|-------------|
| `src/environment/types.ts` | Modify | Add `HealthCheckResult`, add `health` to `UpResult`, add `strict` to `UpOptions` |
| `src/shared/errors.ts` | Modify | Add `PortForwardFailedError` |
| `src/environment/config.ts` | Modify | Add `readinessPath` to `HealthCheckSchema` |
| `src/environment/health.ts` | Modify | Change `waitForHealth()` return type to `HealthCheckResult` |
| `src/environment/processes/PortForwardProcess.ts` | Modify | Add port binding verification in `start()` |
| `src/environment/controller.ts` | Modify | `healthCheckAll()` returns results, strict mode support |
| `src/environment/api.ts` | Modify | Pass strict option, include health in `UpResult` |
| `src/lib.ts` | Modify | Re-export `HealthCheckResult`, `PortForwardFailedError` |
| `src/environment/health.test.ts` | Create | Tests for structured health check results |
| `src/environment/processes/PortForwardProcess.test.ts` | Create | Tests for port binding verification |
