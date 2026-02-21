## Steps


## Testing
This plan IS the test. Run with `npm run test:smoke`.
## Done-when


## Design
### `test/smoke/tier4-port-forward.smoke.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import {
  startPortForward,
  stopAllForwards,
  type PortForwardHandle,
} from './helpers/port-forward.js';
import { httpGet, waitForHttp } from './helpers/http.js';
import { checkHealth } from '../../src/environment/health.js';

const prerequisitesMet = canRunSmokeTests();
const NS = 'smoke-t4';

const BASE_PORT = 18400;

describe.skipIf(!prerequisitesMet).sequential('Tier 4: Port-Forward Resilience', () => {

  beforeAll(async () => {
    createNamespace(NS);
    helmInstall(NS);
    waitForDeployments(NS, 120);
  });

  afterAll(() => {
    stopAllForwards();
    helmUninstall(NS);
    deleteNamespace(NS);
  });

  // --- Concurrent forwards ---
  describe('Concurrent port forwards', () => {
    const services = [
      { name: 'smoke-auth', remote: 3000, local: BASE_PORT },
      { name: 'smoke-api', remote: 3001, local: BASE_PORT + 1 },
      { name: 'smoke-agent', remote: 3002, local: BASE_PORT + 2 },
      { name: 'smoke-mcp', remote: 3003, local: BASE_PORT + 3 },
    ];
    const handles: PortForwardHandle[] = [];

    it('can establish four concurrent port forwards', async () => {
      for (const svc of services) {
        const h = await startPortForward(NS, svc.name, svc.local, svc.remote);
        handles.push(h);
      }
      expect(handles.length).toBe(4);
    });

    it('all four forwards respond to health checks', async () => {
      for (const svc of services) {
        const resp = await httpGet(`http://127.0.0.1:${svc.local}/health`);
        expect(resp.status, `${svc.name} should be healthy`).toBe(200);
      }
    });

    afterAll(() => {
      for (const h of handles) h.stop();
      handles.length = 0;
    });
  });

  // --- Idle timeout ---
  describe('Idle timeout', () => {
    let handle: PortForwardHandle;
    const port = BASE_PORT + 10;

    it('port forward survives 60 seconds of idle', async () => {
      handle = await startPortForward(NS, 'smoke-auth', port, 3000);
      const resp1 = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(resp1.status).toBe(200);

      // Wait 60 seconds with no traffic
      await new Promise(r => setTimeout(r, 60_000));

      // Check if still alive
      const resp2 = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(resp2.status).toBe(200);
    }, 90_000); // 90s timeout for this test

    afterAll(() => {
      if (handle) handle.stop();
    });
  });

  // --- Kill detection ---
  describe('Kill and detection', () => {
    let handle: PortForwardHandle;
    const port = BASE_PORT + 20;

    it('health check detects killed port forward', async () => {
      handle = await startPortForward(NS, 'smoke-auth', port, 3000);

      // Verify it works
      const resp = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(resp.status).toBe(200);

      // Kill the port-forward process
      handle.stop();
      await new Promise(r => setTimeout(r, 1000));

      // Health check should fail
      const healthy = await checkHealth('tcp', '127.0.0.1', port);
      expect(healthy).toBe(false);
    });

    it('can re-establish port forward on same port after kill', async () => {
      // Start a new forward on the same port
      handle = await startPortForward(NS, 'smoke-auth', port, 3000);

      const resp = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(resp.status).toBe(200);
    });

    afterAll(() => {
      if (handle) handle.stop();
    });
  });

  // --- Pod restart under forward ---
  describe('Pod restart under active forward', () => {
    let handle: PortForwardHandle;
    const port = BASE_PORT + 30;

    it('port forward dies when pod restarts', async () => {
      handle = await startPortForward(NS, 'smoke-auth', port, 3000);

      // Verify working
      const resp = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(resp.status).toBe(200);

      // Delete the pod (deployment will recreate)
      execSync(`kubectl delete pod -l app=smoke-auth -n ${NS} --wait=false`, { stdio: 'pipe' });

      // Wait for new pod
      waitForDeployments(NS, 60);

      // Old port forward should be dead (kubectl port-forward does not reconnect)
      await new Promise(r => setTimeout(r, 2000));
      const healthy = await checkHealth('tcp', '127.0.0.1', port);

      // This documents current behavior: forward dies on pod restart.
      // The test passes whether the forward is alive or dead --
      // it records the outcome.
      if (!healthy) {
        console.log('EXPECTED: Port forward died after pod restart (kubectl does not reconnect)');
      } else {
        console.log('UNEXPECTED: Port forward survived pod restart');
      }

      // Either way, verify we can recover
      handle.stop();
    });

    it('can recover by re-establishing port forward after pod restart', async () => {
      handle = await startPortForward(NS, 'smoke-auth', port, 3000);
      const resp = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(resp.status).toBe(200);
    });

    afterAll(() => {
      if (handle) handle.stop();
    });
  });
});
```

### Design notes

**Observational vs prescriptive tests:** The pod-restart test does not assert whether the forward survives or dies. It records the behavior. This is intentional -- the test documents current behavior as a baseline. Future improvements (auto-reconnect) would change the assertion.

**Port allocation:** Each describe block uses a distinct port range (BASE_PORT + offset) to avoid conflicts between sequential test blocks. Even though tests are sequential, port cleanup is not instantaneous (TIME_WAIT state).

**Idle timeout duration:** 60 seconds is chosen as a practical threshold. Real idle timeouts in kubectl depend on TCP keepalive settings and cloud provider load balancers. For local k3d, 60 seconds should be well within tolerance.

## Files
| File | Action | Description |
|------|--------|-------------|
| `test/smoke/tier4-port-forward.smoke.test.ts` | Create | All Tier 4 port-forward resilience tests |
