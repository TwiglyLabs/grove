import { describe, it, expect, afterAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace } from './helpers/cluster.js';
import { helmInstall, helmUninstall, waitForDeployments } from './helpers/deploy.js';
import { httpGet, waitForHttp } from './helpers/http.js';

const CLUSTER_NAME = process.env.SMOKE_CLUSTER_NAME || 'grove-smoke';
const FIXTURES_DIR = process.env.SMOKE_FIXTURES_DIR || join(import.meta.dirname, 'fixtures');
const CHART_DIR = join(FIXTURES_DIR, 'helm', 'grove-smoke');
const NS_PREFIX = 'smoke-tier1';

const prerequisitesMet = canRunSmokeTests();

describe.skipIf(!prerequisitesMet).sequential('Tier 1: Infrastructure', () => {
  const namespacesToCleanup: string[] = [];

  afterAll(async () => {
    for (const ns of namespacesToCleanup) {
      try { deleteNamespace(ns); } catch {}
    }
  });

  it('docker daemon is reachable', () => {
    const output = execSync('docker info --format "{{.ServerVersion}}"', { stdio: 'pipe' }).toString().trim();
    expect(output).toBeTruthy();
  });

  it('k3d cluster is running', () => {
    const output = execSync('kubectl cluster-info', { stdio: 'pipe' }).toString();
    expect(output).toContain('Kubernetes');
  });

  it('stub images were built and loaded', () => {
    const images = ['smoke-auth', 'smoke-api', 'smoke-agent', 'smoke-mcp'];
    for (const image of images) {
      const output = execSync(`docker images ${image}:latest --format "{{.Repository}}"`, { stdio: 'pipe' }).toString().trim();
      expect(output).toBe(image);
    }
  });

  it('helm can install and uninstall a chart', () => {
    const ns = `${NS_PREFIX}-helm-${Date.now()}`;
    namespacesToCleanup.push(ns);
    createNamespace(ns);

    helmInstall({
      release: 'tier1-test',
      chart: CHART_DIR,
      namespace: ns,
    });

    waitForDeployments(ns, 120);

    const output = execSync(`kubectl get deployments -n ${ns} -o name`, { stdio: 'pipe' }).toString().trim();
    const deployments = output.split('\n');
    expect(deployments.length).toBe(4);

    helmUninstall('tier1-test', ns);
  });

  it('port-forward works end-to-end', async () => {
    const ns = `${NS_PREFIX}-pf-${Date.now()}`;
    namespacesToCleanup.push(ns);
    createNamespace(ns);

    helmInstall({
      release: 'tier1-pf',
      chart: CHART_DIR,
      namespace: ns,
    });
    waitForDeployments(ns, 120);

    const localPort = 18080 + Math.floor(Math.random() * 1000);
    const pf = spawn('kubectl', ['port-forward', '-n', ns, 'svc/tier1-pf-auth', `${localPort}:8080`], {
      stdio: 'pipe',
    });

    try {
      const ready = await waitForHttp(`http://127.0.0.1:${localPort}/health`, 15_000);
      expect(ready).toBe(true);

      const res = await httpGet(`http://127.0.0.1:${localPort}/health`);
      expect(res.status).toBe(200);
    } finally {
      pf.kill('SIGTERM');
      helmUninstall('tier1-pf', ns);
    }
  });

  it('namespace isolation holds', async () => {
    const nsA = `${NS_PREFIX}-iso-a-${Date.now()}`;
    const nsB = `${NS_PREFIX}-iso-b-${Date.now()}`;
    namespacesToCleanup.push(nsA, nsB);
    createNamespace(nsA);
    createNamespace(nsB);

    helmInstall({ release: 'iso-a', chart: CHART_DIR, namespace: nsA });
    helmInstall({ release: 'iso-b', chart: CHART_DIR, namespace: nsB });
    waitForDeployments(nsA, 120);
    waitForDeployments(nsB, 120);

    const portA = 19080 + Math.floor(Math.random() * 500);
    const portB = portA + 500;

    const pfA = spawn('kubectl', ['port-forward', '-n', nsA, 'svc/iso-a-auth', `${portA}:8080`], { stdio: 'pipe' });
    const pfB = spawn('kubectl', ['port-forward', '-n', nsB, 'svc/iso-b-auth', `${portB}:8080`], { stdio: 'pipe' });

    try {
      const [readyA, readyB] = await Promise.all([
        waitForHttp(`http://127.0.0.1:${portA}/health`, 15_000),
        waitForHttp(`http://127.0.0.1:${portB}/health`, 15_000),
      ]);
      expect(readyA).toBe(true);
      expect(readyB).toBe(true);

      const [resA, resB] = await Promise.all([
        httpGet(`http://127.0.0.1:${portA}/health`),
        httpGet(`http://127.0.0.1:${portB}/health`),
      ]);
      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
    } finally {
      pfA.kill('SIGTERM');
      pfB.kill('SIGTERM');
      helmUninstall('iso-a', nsA);
      helmUninstall('iso-b', nsB);
    }
  });
});
