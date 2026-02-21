## Steps


## Testing
This plan IS the test. Run with `npm run test:smoke`.
## Done-when


## Design
### `test/smoke/tier2-service-mesh.smoke.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { canRunSmokeTests, formatMissingSmokePrereqs } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import { startPortForward, stopAllForwards } from './helpers/port-forward.js';
import { httpGet, httpPost, waitForHttp } from './helpers/http.js';

const prerequisitesMet = canRunSmokeTests();
const NS = 'smoke-t2';

let authPort: number;
let apiPort: number;
let token: string;

describe.skipIf(!prerequisitesMet).sequential('Tier 2: Service Mesh', () => {

  beforeAll(async () => {
    createNamespace(NS);
    helmInstall(NS);
    waitForDeployments(NS, 120);

    // Port-forward auth and api (the external entry points)
    authPort = 18101;
    apiPort = 18102;
    await startPortForward(NS, 'smoke-auth', authPort, 3000);
    await startPortForward(NS, 'smoke-api', apiPort, 3001);

    // Wait for HTTP readiness
    await waitForHttp(`http://127.0.0.1:${authPort}/health`);
    await waitForHttp(`http://127.0.0.1:${apiPort}/health`);
  });

  afterAll(() => {
    stopAllForwards();
    helmUninstall(NS);
    deleteNamespace(NS);
  });

  // --- Multi-service deployment ---
  describe('Multi-service deployment', () => {
    it('all four services are running', () => {
      const output = execSync(
        `kubectl get pods -n ${NS} -o jsonpath='{range .items[*]}{.metadata.labels.app}{" "}{.status.phase}{"\\n"}{end}'`,
        { encoding: 'utf-8' },
      );
      const lines = output.replace(/'/g, '').trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(4);

      const services = ['smoke-auth', 'smoke-api', 'smoke-agent', 'smoke-mcp'];
      for (const svc of services) {
        const line = lines.find(l => l.startsWith(svc));
        expect(line, `${svc} should be running`).toContain('Running');
      }
    });

    it('all services respond to health checks', async () => {
      const authResp = await httpGet(`http://127.0.0.1:${authPort}/health`);
      expect(authResp.status).toBe(200);

      const apiResp = await httpGet(`http://127.0.0.1:${apiPort}/health`);
      expect(apiResp.status).toBe(200);
    });
  });

  // --- K8s Secret injection ---
  describe('Secret injection', () => {
    it('auth service can issue JWTs (JWT_SECRET injected from K8s Secret)', async () => {
      const resp = await httpPost(`http://127.0.0.1:${authPort}/login`);
      expect(resp.status).toBe(200);
      const body = resp.json<{ token: string }>();
      expect(body.token).toBeTruthy();
      expect(body.token.split('.').length).toBe(3); // JWT format
      token = body.token;
    });

    it('auth service validates issued tokens', async () => {
      const resp = await httpPost(`http://127.0.0.1:${authPort}/verify`, { token });
      expect(resp.status).toBe(200);
      const body = resp.json<{ valid: boolean }>();
      expect(body.valid).toBe(true);
    });

    it('auth service rejects invalid tokens', async () => {
      const resp = await httpPost(`http://127.0.0.1:${authPort}/verify`, { token: 'invalid.token.here' });
      expect(resp.status).toBe(401);
    });
  });

  // --- DNS resolution (inter-service communication) ---
  describe('DNS resolution and inter-service calls', () => {
    it('api rejects unauthenticated requests', async () => {
      const resp = await httpGet(`http://127.0.0.1:${apiPort}/data`);
      expect(resp.status).toBe(401);
    });

    it('api accepts authenticated requests (api -> auth /verify via DNS)', async () => {
      const resp = await httpGet(`http://127.0.0.1:${apiPort}/data`, {
        Authorization: `Bearer ${token}`,
      });
      expect(resp.status).toBe(200);
      const body = resp.json<{ data: number[] }>();
      expect(body.data).toEqual([1, 2, 3]);
    });

    it('full dependency chain: api -> agent -> mcp', async () => {
      const resp = await httpPost(`http://127.0.0.1:${apiPort}/agent/run`, {}, {
        Authorization: `Bearer ${token}`,
      });
      // Note: httpPost helper uses POST method. The api /agent/run
      // endpoint calls agent /execute which calls mcp /tools.
      expect(resp.status).toBe(200);
      const body = resp.json<{ result: string; tools: { tools: string[] } | null }>();
      expect(body.result).toBe('executed');
      // If MCP is reachable, tools should be present
      expect(body.tools).toBeTruthy();
      expect(body.tools!.tools).toContain('search');
    });
  });

  // --- Error propagation ---
  describe('Error propagation', () => {
    it('api returns 502 when agent is unavailable', async () => {
      // Scale agent to 0 replicas
      execSync(`kubectl scale deployment smoke-agent -n ${NS} --replicas=0`, { stdio: 'pipe' });
      execSync(
        `kubectl wait --for=delete pod -l app=smoke-agent -n ${NS} --timeout=30s`,
        { stdio: 'pipe', timeout: 35_000 },
      ).toString(); // may warn but shouldn't throw

      // Wait a moment for service endpoint to deregister
      await new Promise(r => setTimeout(r, 2000));

      const resp = await httpPost(`http://127.0.0.1:${apiPort}/agent/run`, {}, {
        Authorization: `Bearer ${token}`,
      });
      expect(resp.status).toBe(502);
      const body = resp.json<{ error: string }>();
      expect(body.error).toContain('unavailable');

      // Restore agent
      execSync(`kubectl scale deployment smoke-agent -n ${NS} --replicas=1`, { stdio: 'pipe' });
      waitForDeployments(NS, 60);
    });
  });

  // --- Service restart resilience ---
  describe('Service restart resilience', () => {
    it('auth service recovers after pod restart', async () => {
      // Delete the auth pod (deployment will recreate it)
      execSync(`kubectl delete pod -l app=smoke-auth -n ${NS} --wait=false`, { stdio: 'pipe' });

      // Wait for new pod to be ready
      waitForDeployments(NS, 60);

      // Port-forward may have died -- re-establish
      stopAllForwards();
      await startPortForward(NS, 'smoke-auth', authPort, 3000);
      await startPortForward(NS, 'smoke-api', apiPort, 3001);

      // Wait for health
      const ready = await waitForHttp(`http://127.0.0.1:${authPort}/health`, 20, 1000);
      expect(ready).toBe(true);

      // Verify auth still works with same secret
      const loginResp = await httpPost(`http://127.0.0.1:${authPort}/login`);
      expect(loginResp.status).toBe(200);

      const newToken = loginResp.json<{ token: string }>().token;
      const verifyResp = await httpPost(`http://127.0.0.1:${authPort}/verify`, { token: newToken });
      expect(verifyResp.status).toBe(200);
    });
  });
});
```

## Files
| File | Action | Description |
|------|--------|-------------|
| `test/smoke/tier2-service-mesh.smoke.test.ts` | Create | All Tier 2 service mesh tests |
