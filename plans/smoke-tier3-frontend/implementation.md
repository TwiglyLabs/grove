## Steps


## Testing
This plan IS the test. Run with `npm run test:smoke`.
## Done-when


## Design
### `test/smoke/tier3-frontend.smoke.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess, execSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import { startPortForward, stopAllForwards } from './helpers/port-forward.js';
import { httpGet, httpPost, waitForHttp } from './helpers/http.js';

const prerequisitesMet = canRunSmokeTests();
const NS = 'smoke-t3';

const FRONTEND_DIR = join(import.meta.dirname, 'fixtures', 'frontend');
const FRONTEND_PORT = 18200;
let apiPort: number;
let authPort: number;
let viteProcess: ChildProcess | null = null;

describe.skipIf(!prerequisitesMet).sequential('Tier 3: Frontend Integration', () => {

  beforeAll(async () => {
    // Deploy backend services
    createNamespace(NS);
    helmInstall(NS);
    waitForDeployments(NS, 120);

    // Port-forward backend services
    authPort = 18201;
    apiPort = 18202;
    await startPortForward(NS, 'smoke-auth', authPort, 3000);
    await startPortForward(NS, 'smoke-api', apiPort, 3001);
    await waitForHttp(`http://127.0.0.1:${apiPort}/health`);

    // Install frontend dependencies (idempotent)
    execSync('npm install', { cwd: FRONTEND_DIR, stdio: 'pipe', timeout: 60_000 });

    // Start Vite dev server on host
    viteProcess = spawn('npm', ['run', 'dev'], {
      cwd: FRONTEND_DIR,
      env: {
        ...process.env,
        PORT: String(FRONTEND_PORT),
        GROVE_API_PORT: String(apiPort),
      },
      stdio: 'pipe',
    });

    // Wait for Vite to be ready
    const ready = await waitForHttp(`http://127.0.0.1:${FRONTEND_PORT}/`, 30, 1000);
    if (!ready) {
      throw new Error('Vite dev server failed to start');
    }
  }, 120_000); // 2 min for npm install + vite startup

  afterAll(() => {
    // Kill Vite
    if (viteProcess) {
      try { viteProcess.kill('SIGTERM'); } catch {}
      viteProcess = null;
    }

    stopAllForwards();
    helmUninstall(NS);
    deleteNamespace(NS);
  });

  // --- Dev server startup ---
  describe('Dev server startup', () => {
    it('Vite dev server is running on allocated port', async () => {
      const resp = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/`);
      expect(resp.status).toBe(200);
    });

    it('serves HTML content', async () => {
      const resp = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/`);
      expect(resp.body).toContain('<!DOCTYPE html>');
      expect(resp.body).toContain('Grove Smoke');
    });
  });

  // --- Proxy behavior ---
  describe('Vite proxy to API', () => {
    let token: string;

    it('POST /api/login is proxied to smoke-api', async () => {
      const resp = await httpPost(`http://127.0.0.1:${FRONTEND_PORT}/api/login`);
      expect(resp.status).toBe(200);
      const body = resp.json<{ token: string }>();
      expect(body.token).toBeTruthy();
      token = body.token;
    });

    it('GET /api/data with Bearer token returns data', async () => {
      const resp = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/api/data`, {
        Authorization: `Bearer ${token}`,
      });
      expect(resp.status).toBe(200);
      const body = resp.json<{ data: number[] }>();
      expect(body.data).toEqual([1, 2, 3]);
    });

    it('GET /api/data without token returns 401', async () => {
      const resp = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/api/data`);
      expect(resp.status).toBe(401);
    });
  });

  // --- CORS direct access ---
  describe('CORS direct access', () => {
    it('direct fetch to API port works (no CORS issue for same-origin proxy)', async () => {
      // Direct access to the API (bypassing Vite proxy) should still work
      // for tools like curl or Postman. This is not a CORS test per se
      // (CORS is a browser enforcement) but verifies the API is accessible.
      const resp = await httpGet(`http://127.0.0.1:${apiPort}/health`);
      expect(resp.status).toBe(200);
    });
  });

  // --- Hot reload latency (Colima VirtioFS) ---
  describe('Hot reload latency', () => {
    it('file change is detected by Vite within 5 seconds', async () => {
      const appFile = join(FRONTEND_DIR, 'src', 'App.jsx');
      const originalContent = readFileSync(appFile, 'utf-8');

      // Add a unique marker comment
      const marker = `__SMOKE_TEST_${Date.now()}__`;
      const modifiedContent = originalContent.replace(
        'Grove Smoke Frontend',
        `Grove Smoke Frontend ${marker}`,
      );

      const start = Date.now();
      writeFileSync(appFile, modifiedContent, 'utf-8');

      // Poll the dev server for the updated content
      let detected = false;
      for (let i = 0; i < 50; i++) {
        await new Promise(r => setTimeout(r, 100));
        try {
          const resp = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/src/App.jsx`);
          // Vite serves source files in dev mode
          if (resp.body.includes(marker)) {
            detected = true;
            break;
          }
        } catch {}
      }

      const elapsed = Date.now() - start;

      // Restore original file
      writeFileSync(appFile, originalContent, 'utf-8');

      expect(detected, `Vite should detect file change within 5s (took ${elapsed}ms)`).toBe(true);
      expect(elapsed).toBeLessThan(5000);

      console.log(`Hot reload latency: ${elapsed}ms`);
    });
  });
});
```

### Key design notes

**Frontend runs on host, not in K8s:** This mirrors how Grove actually works. `GenericDevServer` spawns the frontend command on the host machine. The Vite dev server runs locally and uses Vite's built-in proxy to reach the port-forwarded backend services.

**`npm install` in beforeAll:** The frontend fixture has its own `package.json`. The test runs `npm install` to ensure dependencies are present. This is cached after the first run.

**Hot reload test:** Writes a file, then polls the Vite dev server for the change. Vite serves source files in dev mode, so we can check `/src/App.jsx` directly. The 5-second threshold accounts for VirtioFS latency on Colima. If this test fails consistently, it indicates a Colima configuration issue (VirtioFS mount not working or using 9p instead).

## Files
| File | Action | Description |
|------|--------|-------------|
| `test/smoke/tier3-frontend.smoke.test.ts` | Create | All Tier 3 frontend integration tests |
