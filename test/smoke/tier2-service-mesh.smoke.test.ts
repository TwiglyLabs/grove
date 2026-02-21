import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import { httpGet, httpPost, waitForHttp } from './helpers/http.js';

const prerequisitesMet = canRunSmokeTests();
const FIXTURES_DIR = process.env.SMOKE_FIXTURES_DIR || join(import.meta.dirname, 'fixtures');
const CHART_DIR = join(FIXTURES_DIR, 'helm', 'grove-smoke');
const NAMESPACE = `smoke-tier2-${Date.now()}`;
const RELEASE = 'tier2';

// Port allocation for this tier
const BASE_PORT = 20080;
const PORTS = {
  auth: BASE_PORT,
  api: BASE_PORT + 1,
  agent: BASE_PORT + 2,
  mcp: BASE_PORT + 3,
};

function authUrl(path: string): string {
  return `http://127.0.0.1:${PORTS.auth}${path}`;
}

function apiUrl(path: string): string {
  return `http://127.0.0.1:${PORTS.api}${path}`;
}

function agentUrl(path: string): string {
  return `http://127.0.0.1:${PORTS.agent}${path}`;
}

function mcpUrl(path: string): string {
  return `http://127.0.0.1:${PORTS.mcp}${path}`;
}

describe.skipIf(!prerequisitesMet).sequential('Tier 2: Service Mesh', () => {
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

    // Wait for all health checks
    await Promise.all([
      waitForHttp(authUrl('/health'), 30_000),
      waitForHttp(apiUrl('/health'), 30_000),
      waitForHttp(agentUrl('/health'), 30_000),
      waitForHttp(mcpUrl('/health'), 30_000),
    ]);
  }, 120_000);

  afterAll(async () => {
    for (const pf of portForwards) {
      try { pf.kill('SIGTERM'); } catch {}
    }
    try { helmUninstall(RELEASE, NAMESPACE); } catch {}
    try { deleteNamespace(NAMESPACE); } catch {}
  });

  it('all services are healthy', async () => {
    const [auth, api, agent, mcp] = await Promise.all([
      httpGet(authUrl('/health')),
      httpGet(apiUrl('/health')),
      httpGet(agentUrl('/health')),
      httpGet(mcpUrl('/health')),
    ]);
    expect(auth.status).toBe(200);
    expect(api.status).toBe(200);
    expect(agent.status).toBe(200);
    expect(mcp.status).toBe(200);
  });

  it('auth issues and verifies JWTs', async () => {
    // Login
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    expect(loginRes.status).toBe(200);
    const { token } = JSON.parse(loginRes.body);
    expect(token).toBeTruthy();

    // Verify valid token
    const verifyRes = await httpPost(authUrl('/verify'), {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(verifyRes.status).toBe(200);

    // Verify invalid token
    const invalidRes = await httpPost(authUrl('/verify'), {}, {
      Authorization: 'Bearer garbage-token',
    });
    expect(invalidRes.status).toBe(401);
  });

  it('api authenticates requests via auth service (internal DNS)', async () => {
    // Get a token directly from auth
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    const { token } = JSON.parse(loginRes.body);

    // Authenticated request to api
    const dataRes = await httpGet(apiUrl('/data'), {
      Authorization: `Bearer ${token}`,
    });
    expect(dataRes.status).toBe(200);

    // Unauthenticated request to api
    const noAuthRes = await httpGet(apiUrl('/data'));
    expect(noAuthRes.status).toBe(401);
  });

  it('api calls agent which calls mcp (full chain)', async () => {
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    const { token } = JSON.parse(loginRes.body);

    const runRes = await httpPost(apiUrl('/agent/run'), {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(runRes.status).toBe(200);

    const body = JSON.parse(runRes.body);
    // Agent result should be present
    expect(body.result).toBe('ok');
    // MCP tools should be present (agent calls mcp)
    expect(body.tools).toBeDefined();
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
  });

  it('api returns 502 when agent is down', async () => {
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    const { token } = JSON.parse(loginRes.body);

    // Scale agent to 0
    execSync(`kubectl scale deployment ${RELEASE}-agent --replicas=0 -n ${NAMESPACE}`, { stdio: 'pipe' });
    // Wait for pod termination
    try {
      execSync(`kubectl wait --for=delete pod -l app=${RELEASE}-agent -n ${NAMESPACE} --timeout=30s`, { stdio: 'pipe' });
    } catch {
      // May not have pods to wait for
    }
    await new Promise(resolve => setTimeout(resolve, 2000));

    const runRes = await httpPost(apiUrl('/agent/run'), {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(runRes.status).toBe(502);

    // Scale back up
    execSync(`kubectl scale deployment ${RELEASE}-agent --replicas=1 -n ${NAMESPACE}`, { stdio: 'pipe' });
    execSync(`kubectl wait --for=condition=available deployment/${RELEASE}-agent -n ${NAMESPACE} --timeout=60s`, { stdio: 'pipe' });
    await waitForHttp(agentUrl('/health'), 30_000);

    // Verify recovery
    const recoveryRes = await httpPost(apiUrl('/agent/run'), {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(recoveryRes.status).toBe(200);
  });

  it('api returns 502 when auth is down', async () => {
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    const { token } = JSON.parse(loginRes.body);

    // Scale auth to 0
    execSync(`kubectl scale deployment ${RELEASE}-auth --replicas=0 -n ${NAMESPACE}`, { stdio: 'pipe' });
    try {
      execSync(`kubectl wait --for=delete pod -l app=${RELEASE}-auth -n ${NAMESPACE} --timeout=30s`, { stdio: 'pipe' });
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2000));

    // API can't verify token → 502
    const dataRes = await httpGet(apiUrl('/data'), {
      Authorization: `Bearer ${token}`,
    });
    expect(dataRes.status).toBe(502);

    // Scale back up
    execSync(`kubectl scale deployment ${RELEASE}-auth --replicas=1 -n ${NAMESPACE}`, { stdio: 'pipe' });
    execSync(`kubectl wait --for=condition=available deployment/${RELEASE}-auth -n ${NAMESPACE} --timeout=60s`, { stdio: 'pipe' });
    await waitForHttp(authUrl('/health'), 30_000);
  });

  it('service recovers after pod restart', async () => {
    // Delete auth pod
    execSync(`kubectl delete pod -l app=${RELEASE}-auth -n ${NAMESPACE}`, { stdio: 'pipe' });
    // Wait for replacement
    execSync(`kubectl wait --for=condition=ready pod -l app=${RELEASE}-auth -n ${NAMESPACE} --timeout=60s`, { stdio: 'pipe' });

    // Need to re-establish port-forward since the old pod is gone
    // Kill old auth port-forward and start new one
    portForwards[0]?.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const newPf = spawn('kubectl', [
      'port-forward', '-n', NAMESPACE,
      `svc/${RELEASE}-auth`, `${PORTS.auth}:8080`,
    ], { stdio: 'pipe' });
    portForwards[0] = newPf;

    await waitForHttp(authUrl('/health'), 15_000);

    // Verify auth works after restart
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    expect(loginRes.status).toBe(200);
  });

  it('secret is mounted correctly', async () => {
    // Login to get a JWT
    const loginRes = await httpPost(authUrl('/login'), { user: 'test', pass: 'test' });
    expect(loginRes.status).toBe(200);
    const { token } = JSON.parse(loginRes.body);

    // Decode JWT to verify structure
    const parts = token.split('.');
    expect(parts.length).toBe(3);

    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    expect(payload.sub).toBe('test');
    expect(payload.iat).toBeDefined();

    // Verify the token is accepted (proves secret is correctly mounted)
    const verifyRes = await httpPost(authUrl('/verify'), {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(verifyRes.status).toBe(200);
  });
});
