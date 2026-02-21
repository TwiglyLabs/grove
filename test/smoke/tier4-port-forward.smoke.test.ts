import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import { httpGet, waitForHttp } from './helpers/http.js';

const prerequisitesMet = canRunSmokeTests();
const FIXTURES_DIR = process.env.SMOKE_FIXTURES_DIR || join(import.meta.dirname, 'fixtures');
const CHART_DIR = join(FIXTURES_DIR, 'helm', 'grove-smoke');
const NAMESPACE = `smoke-tier4-${Date.now()}`;
const RELEASE = 'tier4';

const BASE_PORT = 22080;
const PORTS = {
  auth: BASE_PORT,
  api: BASE_PORT + 1,
  agent: BASE_PORT + 2,
  mcp: BASE_PORT + 3,
};

function checkTcpPort(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe.skipIf(!prerequisitesMet).sequential('Tier 4: Port-Forward Resilience', () => {
  const portForwards: ChildProcess[] = [];

  beforeAll(async () => {
    createNamespace(NAMESPACE);
    helmInstall({ release: RELEASE, chart: CHART_DIR, namespace: NAMESPACE });
    waitForDeployments(NAMESPACE, 120);

    // Start port-forwards to all 4 services
    const services = [
      { name: 'auth', port: PORTS.auth },
      { name: 'api', port: PORTS.api },
      { name: 'agent', port: PORTS.agent },
      { name: 'mcp', port: PORTS.mcp },
    ];

    for (const svc of services) {
      const pf = spawn('kubectl', [
        'port-forward', '-n', NAMESPACE,
        `svc/${RELEASE}-${svc.name}`, `${svc.port}:8080`,
      ], { stdio: 'pipe' });
      portForwards.push(pf);
    }

    // Wait for all to be ready
    await Promise.all(
      services.map(svc => waitForHttp(`http://127.0.0.1:${svc.port}/health`, 30_000))
    );
  }, 120_000);

  afterAll(async () => {
    for (const pf of portForwards) {
      try { pf.kill('SIGTERM'); } catch {}
    }
    try { helmUninstall(RELEASE, NAMESPACE); } catch {}
    try { deleteNamespace(NAMESPACE); } catch {}
  });

  it('concurrent port-forwards all respond', async () => {
    const results = await Promise.all([
      httpGet(`http://127.0.0.1:${PORTS.auth}/health`),
      httpGet(`http://127.0.0.1:${PORTS.api}/health`),
      httpGet(`http://127.0.0.1:${PORTS.agent}/health`),
      httpGet(`http://127.0.0.1:${PORTS.mcp}/health`),
    ]);

    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });

  it('port-forward survives 60s idle', async () => {
    // Verify all healthy first
    for (const port of Object.values(PORTS)) {
      const res = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
    }

    // Wait 60 seconds
    await new Promise(resolve => setTimeout(resolve, 60_000));

    // Verify all still respond
    for (const port of Object.values(PORTS)) {
      const res = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
    }
  }, 120_000);

  it('dead port-forward is detected', async () => {
    // Get PID of auth port-forward
    const authPf = portForwards[0];
    const pid = authPf.pid!;

    // Kill it hard
    process.kill(pid, 'SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // TCP check should fail
    const reachable = await checkTcpPort('127.0.0.1', PORTS.auth);
    expect(reachable).toBe(false);
  });

  it('port-forward can be re-established on same port', async () => {
    // Start new port-forward on the same port (auth was killed in previous test)
    const newPf = spawn('kubectl', [
      'port-forward', '-n', NAMESPACE,
      `svc/${RELEASE}-auth`, `${PORTS.auth}:8080`,
    ], { stdio: 'pipe' });
    portForwards[0] = newPf;

    const ready = await waitForHttp(`http://127.0.0.1:${PORTS.auth}/health`, 15_000);
    expect(ready).toBe(true);

    const res = await httpGet(`http://127.0.0.1:${PORTS.auth}/health`);
    expect(res.status).toBe(200);
  });

  it('pod restart under active port-forward', async () => {
    // Delete the auth pod
    execSync(`kubectl delete pod -l app=${RELEASE}-auth -n ${NAMESPACE}`, { stdio: 'pipe' });

    // Wait for replacement pod
    execSync(
      `kubectl wait --for=condition=ready pod -l app=${RELEASE}-auth -n ${NAMESPACE} --timeout=60s`,
      { stdio: 'pipe' }
    );

    // Try the existing port-forward — kubectl port-forward does NOT auto-reconnect
    let needsReconnect = false;
    try {
      const res = await httpGet(`http://127.0.0.1:${PORTS.auth}/health`);
      if (res.status !== 200) {
        needsReconnect = true;
      }
    } catch {
      needsReconnect = true;
    }

    if (needsReconnect) {
      // Expected: port-forward broke. Re-establish it.
      portForwards[0]?.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const newPf = spawn('kubectl', [
        'port-forward', '-n', NAMESPACE,
        `svc/${RELEASE}-auth`, `${PORTS.auth}:8080`,
      ], { stdio: 'pipe' });
      portForwards[0] = newPf;

      const ready = await waitForHttp(`http://127.0.0.1:${PORTS.auth}/health`, 15_000);
      expect(ready).toBe(true);
    }

    // Either way, verify it works now
    const res = await httpGet(`http://127.0.0.1:${PORTS.auth}/health`);
    expect(res.status).toBe(200);
  });
});
