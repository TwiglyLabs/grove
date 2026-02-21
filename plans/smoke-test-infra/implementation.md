## Steps


## Testing
The smoke test infrastructure is itself tested by the smoke tests (tiers 1-5). No separate unit tests for helper functions -- they are simple wrappers around CLI commands.

The `globalSetup.ts` is verified by running `npm run test:smoke` and observing that the cluster, images, and namespace are created correctly.
## Done-when


## Design
### `vitest.smoke.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/smoke/**/*.smoke.test.ts'],
    testTimeout: 300_000,    // 5 minutes per test
    hookTimeout: 120_000,    // 2 minutes for setup/teardown hooks
    globalSetup: ['test/smoke/globalSetup.ts'],
    // Sequential execution -- smoke tests share cluster state
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
```

### `package.json` addition

```json
"test:smoke": "vitest run --config vitest.smoke.config.ts"
```

### `test/smoke/helpers/prerequisites.ts`

```typescript
import { execSync } from 'child_process';

export interface SmokePrerequisites {
  docker: boolean;
  dockerRunning: boolean;   // docker info succeeds (Colima running)
  kubectl: boolean;
  helm: boolean;
  k3d: boolean;
}

function commandExists(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

function dockerRunning(): boolean {
  try { execSync('docker info', { stdio: 'pipe', timeout: 10000 }); return true; }
  catch { return false; }
}

export function checkSmokePrerequisites(): SmokePrerequisites {
  return {
    docker: commandExists('docker'),
    dockerRunning: dockerRunning(),
    kubectl: commandExists('kubectl'),
    helm: commandExists('helm'),
    k3d: commandExists('k3d'),
  };
}

export function canRunSmokeTests(): boolean {
  const p = checkSmokePrerequisites();
  return p.docker && p.dockerRunning && p.kubectl && p.helm && p.k3d;
}

export function formatMissingSmokePrereqs(): string {
  const p = checkSmokePrerequisites();
  const missing: string[] = [];
  if (!p.docker) missing.push('docker');
  if (!p.dockerRunning) missing.push('docker daemon (run colima start)');
  if (!p.kubectl) missing.push('kubectl');
  if (!p.helm) missing.push('helm');
  if (!p.k3d) missing.push('k3d');
  return `Missing: ${missing.join(', ')}`;
}
```

### `test/smoke/helpers/cluster.ts`

```typescript
import { execSync } from 'child_process';

const SMOKE_CLUSTER = 'grove-smoke';

export function createSmokeCluster(): void {
  if (clusterExists()) return; // idempotent
  execSync(`k3d cluster create ${SMOKE_CLUSTER} --wait`, {
    stdio: 'inherit',
    timeout: 120_000,
  });
}

export function deleteSmokeCluster(): void {
  if (!clusterExists()) return;
  execSync(`k3d cluster delete ${SMOKE_CLUSTER}`, {
    stdio: 'inherit',
    timeout: 60_000,
  });
}

export function clusterExists(): boolean {
  try {
    const out = execSync('k3d cluster list -o json', { encoding: 'utf-8' });
    const clusters = JSON.parse(out) as Array<{ name: string }>;
    return clusters.some(c => c.name === SMOKE_CLUSTER);
  } catch { return false; }
}

export function setContext(): void {
  execSync(`kubectl config use-context k3d-${SMOKE_CLUSTER}`, { stdio: 'pipe' });
}

export function createNamespace(ns: string): void {
  try { execSync(`kubectl get namespace ${ns}`, { stdio: 'pipe' }); }
  catch { execSync(`kubectl create namespace ${ns}`, { stdio: 'pipe' }); }
}

export function deleteNamespace(ns: string): void {
  try { execSync(`kubectl delete namespace ${ns} --wait=false`, { stdio: 'pipe' }); }
  catch { /* may not exist */ }
}

export function getClusterName(): string { return SMOKE_CLUSTER; }
```

### `test/smoke/helpers/images.ts`

```typescript
import { execSync } from 'child_process';
import { join } from 'path';

const SERVICES = ['smoke-auth', 'smoke-api', 'smoke-agent', 'smoke-mcp'];
const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'services');

export function buildAllImages(): void {
  for (const svc of SERVICES) {
    const ctx = join(FIXTURES_DIR, svc);
    execSync(`docker build -t ${svc}:latest ${ctx}`, { stdio: 'inherit', timeout: 60_000 });
  }
}

export function loadAllImages(clusterName: string): void {
  for (const svc of SERVICES) {
    execSync(`k3d image import ${svc}:latest --cluster ${clusterName}`, {
      stdio: 'inherit', timeout: 60_000,
    });
  }
}

export function buildAndLoadAll(clusterName: string): void {
  buildAllImages();
  loadAllImages(clusterName);
}
```

### `test/smoke/helpers/deploy.ts`

```typescript
import { execSync } from 'child_process';
import { join } from 'path';

const CHART_DIR = join(import.meta.dirname, '..', 'fixtures', 'helm', 'grove-smoke');

export function helmInstall(namespace: string, release: string = 'smoke'): void {
  execSync(
    `helm upgrade --install ${release} ${CHART_DIR} -n ${namespace} --create-namespace --wait --timeout 2m`,
    { stdio: 'inherit', timeout: 180_000 },
  );
}

export function helmUninstall(namespace: string, release: string = 'smoke'): void {
  try {
    execSync(`helm uninstall ${release} -n ${namespace} --wait`, {
      stdio: 'pipe', timeout: 60_000,
    });
  } catch { /* may not exist */ }
}

export function waitForDeployments(namespace: string, timeoutSeconds: number = 120): void {
  execSync(
    `kubectl wait --for=condition=available --timeout=${timeoutSeconds}s deployment --all -n ${namespace}`,
    { stdio: 'inherit', timeout: (timeoutSeconds + 10) * 1000 },
  );
}

export function getServiceClusterIP(namespace: string, serviceName: string): string {
  return execSync(
    `kubectl get svc ${serviceName} -n ${namespace} -o jsonpath='{.spec.clusterIP}'`,
    { encoding: 'utf-8', timeout: 10_000 },
  ).trim().replace(/'/g, '');
}
```

### `test/smoke/helpers/port-forward.ts`

```typescript
import { spawn, type ChildProcess } from 'child_process';
import { checkHealth } from '../../../src/environment/health.js';

export interface PortForwardHandle {
  pid: number;
  process: ChildProcess;
  localPort: number;
  stop(): void;
}

const activeForwards: PortForwardHandle[] = [];

export async function startPortForward(
  namespace: string,
  service: string,
  localPort: number,
  remotePort: number,
): Promise<PortForwardHandle> {
  const child = spawn('kubectl', [
    'port-forward', '-n', namespace, `svc/${service}`,
    `${localPort}:${remotePort}`,
  ], { stdio: 'pipe' });

  const handle: PortForwardHandle = {
    pid: child.pid!,
    process: child,
    localPort,
    stop() {
      try { child.kill('SIGTERM'); } catch {}
    },
  };

  activeForwards.push(handle);

  // Wait for port to be ready
  let ready = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    ready = await checkHealth('tcp', '127.0.0.1', localPort);
    if (ready) break;
  }

  if (!ready) {
    handle.stop();
    throw new Error(`Port forward to ${service}:${remotePort} failed to bind on ${localPort}`);
  }

  return handle;
}

export function stopAllForwards(): void {
  for (const h of activeForwards) h.stop();
  activeForwards.length = 0;
}
```

### `test/smoke/helpers/http.ts`

```typescript
import http from 'http';

export interface HttpResponse {
  status: number;
  body: string;
  json<T = unknown>(): T;
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return httpRequest('GET', url, undefined, headers);
}

export async function httpPost(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
  return httpRequest('POST', url, body, headers);
}

function httpRequest(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 10_000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        status: res.statusCode!,
        body: data,
        json: <T>() => JSON.parse(data) as T,
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.end(JSON.stringify(body));
    else req.end();
  });
}

export async function waitForHttp(
  url: string, maxAttempts = 30, intervalMs = 1000,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await httpGet(url);
      if (resp.status >= 200 && resp.status < 500) return true;
    } catch {}
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}
```

### `test/smoke/helpers/cleanup.ts`

```typescript
import { stopAllForwards } from './port-forward.js';
import { helmUninstall } from './deploy.js';
import { deleteNamespace } from './cluster.js';

export async function cleanupTier(namespace: string, release: string = 'smoke'): Promise<void> {
  // Order matters: stop port-forwards first, then helm, then namespace
  stopAllForwards();
  helmUninstall(namespace, release);
  deleteNamespace(namespace);
}
```

### `test/smoke/globalSetup.ts`

```typescript
import { canRunSmokeTests, formatMissingSmokePrereqs } from './helpers/prerequisites.js';
import { createSmokeCluster, setContext, getClusterName } from './helpers/cluster.js';
import { buildAndLoadAll } from './helpers/images.js';

export async function setup(): Promise<void> {
  if (!canRunSmokeTests()) {
    console.warn(`Skipping smoke tests: ${formatMissingSmokePrereqs()}`);
    // Vitest global setup cannot skip -- tests use describe.skipIf internally
    return;
  }
  
  console.log('\n=== Smoke Test Global Setup ===');
  createSmokeCluster();
  setContext();
  buildAndLoadAll(getClusterName());
  console.log('=== Global Setup Complete ===\n');
}

export async function teardown(): Promise<void> {
  // Cluster is left running for faster re-runs.
  // Run `k3d cluster delete grove-smoke` manually to clean up.
  console.log('\n=== Smoke cluster left running for re-use. Delete with: k3d cluster delete grove-smoke ===');
}
```

## Files
| File | Action | Description |
|------|--------|-------------|
| `vitest.smoke.config.ts` | Create | Vitest config for smoke tests (300s timeout, sequential) |
| `package.json` | Modify | Add `test:smoke` script |
| `test/smoke/helpers/prerequisites.ts` | Create | Colima/k3d prerequisite checks |
| `test/smoke/helpers/cluster.ts` | Create | Cluster create/delete, namespace management |
| `test/smoke/helpers/images.ts` | Create | Docker build + k3d image load |
| `test/smoke/helpers/deploy.ts` | Create | Helm install/uninstall, deployment wait |
| `test/smoke/helpers/port-forward.ts` | Create | Port-forward start/stop/verify |
| `test/smoke/helpers/http.ts` | Create | HTTP client helpers |
| `test/smoke/helpers/cleanup.ts` | Create | Comprehensive teardown |
| `test/smoke/globalSetup.ts` | Create | Build images, create cluster |
| `test/smoke/globalTeardown.ts` | Create | Teardown instructions (cluster left for reuse) |
| `test/smoke/README.md` | Create | Documentation |
