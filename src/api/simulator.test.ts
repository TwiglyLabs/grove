import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `grove-api-sim-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add } = await import('./repo.js');
const { connectMetro, cloneSimulator } = await import('./simulator.js');
const { EnvironmentNotRunningError } = await import('./errors.js');

function createRepoDir(name: string, groveYaml?: string): string {
  const repoPath = join(testDir, 'repos', name);
  mkdirSync(repoPath, { recursive: true });
  if (groveYaml) {
    writeFileSync(join(repoPath, '.grove.yaml'), groveYaml, 'utf-8');
  }
  return repoPath;
}

describe('simulator API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('cloneSimulator', () => {
    it('throws when no simulator config exists', async () => {
      const yaml = `
project:
  name: test-project
  cluster: test-cluster
helm:
  chart: ./chart
  release: test
  valuesFiles: [values.yaml]
services:
  - name: api
`;
      const repoPath = createRepoDir('sim-no-config', yaml);
      const entry = await add(repoPath);

      await expect(cloneSimulator(entry.id)).rejects.toThrow('No simulator configuration');
    });
  });

  describe('connectMetro', () => {
    it('throws EnvironmentNotRunningError when no state', async () => {
      const yaml = `
project:
  name: test-project
  cluster: test-cluster
helm:
  chart: ./chart
  release: test
  valuesFiles: [values.yaml]
services:
  - name: api
simulator:
  platform: ios
  bundleId: com.test.app
  appName: TestApp
  simulatorPrefix: test
  baseDevice: [iPhone 15]
  deepLinkScheme: testapp
  metroFrontend: mobile
`;
      const repoPath = createRepoDir('sim-no-state', yaml);
      const entry = await add(repoPath);

      await expect(connectMetro(entry.id, 'some-udid')).rejects.toThrow(EnvironmentNotRunningError);
    });
  });
});
