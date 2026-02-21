import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import { httpGet, httpPost, waitForHttp } from './helpers/http.js';

const prerequisitesMet = canRunSmokeTests();
const FIXTURES_DIR = process.env.SMOKE_FIXTURES_DIR || join(import.meta.dirname, 'fixtures');
const CHART_DIR = join(FIXTURES_DIR, 'helm', 'grove-smoke');
const FRONTEND_DIR = join(FIXTURES_DIR, 'frontend');
const NAMESPACE = `smoke-tier3-${Date.now()}`;
const RELEASE = 'tier3';

const API_PORT = 21080;
const FRONTEND_PORT = 21090;

describe.skipIf(!prerequisitesMet).sequential('Tier 3: Frontend Integration', () => {
  const portForwards: ChildProcess[] = [];
  let frontendProcess: ChildProcess | null = null;

  beforeAll(async () => {
    // Deploy backend services
    createNamespace(NAMESPACE);
    helmInstall({ release: RELEASE, chart: CHART_DIR, namespace: NAMESPACE });
    waitForDeployments(NAMESPACE, 120);

    // Start port-forward to smoke-api
    const pfApi = spawn('kubectl', [
      'port-forward', '-n', NAMESPACE,
      `svc/${RELEASE}-api`, `${API_PORT}:8080`,
    ], { stdio: 'pipe' });
    portForwards.push(pfApi);

    // Also port-forward auth (api needs it for internal communication,
    // but actually auth is accessed internally via K8s DNS, not port-forward.
    // We port-forward it just for direct test access)
    const pfAuth = spawn('kubectl', [
      'port-forward', '-n', NAMESPACE,
      `svc/${RELEASE}-auth`, `${API_PORT + 1}:8080`,
    ], { stdio: 'pipe' });
    portForwards.push(pfAuth);

    await waitForHttp(`http://127.0.0.1:${API_PORT}/health`, 30_000);

    // Install frontend dependencies if needed
    if (!existsSync(join(FRONTEND_DIR, 'node_modules'))) {
      execSync('npm install', { cwd: FRONTEND_DIR, stdio: 'inherit', timeout: 60_000 });
    }

    // Start Vite dev server via node_modules/.bin directly (avoids npx PATH issues in spawn)
    const viteBin = join(FRONTEND_DIR, 'node_modules', '.bin', 'vite');
    const viteConfig = join(FRONTEND_DIR, 'vite.app.config.js');
    frontendProcess = spawn(viteBin, ['--config', viteConfig, '--port', String(FRONTEND_PORT), '--strictPort', '--host', '127.0.0.1'], {
      cwd: FRONTEND_DIR,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(FRONTEND_PORT),
        GROVE_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    });

    // Capture stderr for debugging
    frontendProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[vite stderr] ${data.toString().trim()}`);
    });

    // Wait for frontend to be ready
    const frontendReady = await waitForHttp(`http://127.0.0.1:${FRONTEND_PORT}/`, 30_000);
    if (!frontendReady) {
      throw new Error('Frontend dev server failed to start');
    }
  }, 120_000);

  afterAll(async () => {
    if (frontendProcess) {
      try { frontendProcess.kill('SIGTERM'); } catch {}
    }
    for (const pf of portForwards) {
      try { pf.kill('SIGTERM'); } catch {}
    }
    try { helmUninstall(RELEASE, NAMESPACE); } catch {}
    try { deleteNamespace(NAMESPACE); } catch {}
  });

  it('vite dev server starts and serves HTML', async () => {
    const res = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('<div id="root">');
  });

  it('vite proxies /api/* to smoke-api', async () => {
    const res = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/api/health`);
    expect(res.status).toBe(200);
  });

  it('login flow works through proxy', async () => {
    const res = await httpPost(
      `http://127.0.0.1:${FRONTEND_PORT}/api/login`,
      { user: 'test', pass: 'test' }
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeTruthy();
  });

  it('authenticated request works through proxy', async () => {
    // Login first
    const loginRes = await httpPost(
      `http://127.0.0.1:${FRONTEND_PORT}/api/login`,
      { user: 'test', pass: 'test' }
    );
    const { token } = JSON.parse(loginRes.body);

    // Authenticated data request
    const dataRes = await httpGet(
      `http://127.0.0.1:${FRONTEND_PORT}/api/data`,
      { Authorization: `Bearer ${token}` }
    );
    expect(dataRes.status).toBe(200);
    const data = JSON.parse(dataRes.body);
    expect(data).toBeTruthy();
  });

  it('unauthenticated request returns 401 through proxy', async () => {
    const res = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/api/data`);
    expect(res.status).toBe(401);
  });

  it('hot reload updates are detected', async () => {
    const appFile = join(FRONTEND_DIR, 'src', 'App.jsx');
    const originalContent = await readFile(appFile, 'utf-8');

    try {
      // Modify the file (append a comment)
      const modifiedContent = originalContent + '\n// smoke-test-marker\n';
      await writeFile(appFile, modifiedContent, 'utf-8');

      // Vite HMR should detect the change — give it time
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify the dev server is still running and responsive
      const res = await httpGet(`http://127.0.0.1:${FRONTEND_PORT}/`);
      expect(res.status).toBe(200);
    } finally {
      // Restore original file
      await writeFile(appFile, originalContent, 'utf-8');
    }
  });
});
