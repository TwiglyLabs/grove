import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { sanitizeBranchName } from '../workspace/sanitize.js';

const testDir = join(tmpdir(), `grove-env-api-test-${process.pid}`);

function getWorktreeId(): string {
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    return sanitizeBranchName(branch);
  } catch {
    return 'main';
  }
}

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add } = await import('../repo/api.js');
const { status, down } = await import('./api.js');

function createRepoDir(name: string, groveYaml?: string): string {
  const repoPath = join(testDir, 'repos', name);
  mkdirSync(repoPath, { recursive: true });
  if (groveYaml) {
    writeFileSync(join(repoPath, '.grove.yaml'), groveYaml, 'utf-8');
  }
  return repoPath;
}

describe('environment API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('status', () => {
    it('returns null when no environment state exists', async () => {
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
      const repoPath = createRepoDir('env-status-no-state', yaml);
      const entry = await add(repoPath);

      const result = await status(entry.id);
      expect(result).toBeNull();
    });

    it('returns DashboardData when state exists', async () => {
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
    portForward:
      remotePort: 3000
`;
      const repoPath = createRepoDir('env-status-with-state', yaml);
      const entry = await add(repoPath);

      // Write a fake state file
      const stateDir = join(repoPath, '.grove');
      mkdirSync(stateDir, { recursive: true });
      const worktreeId = getWorktreeId();
      const state = {
        namespace: `test-project-${worktreeId}`,
        branch: worktreeId,
        worktreeId,
        ports: { api: 10000 },
        urls: { api: 'http://127.0.0.1:10000' },
        processes: {},
        lastEnsure: new Date().toISOString(),
      };
      writeFileSync(join(stateDir, `${worktreeId}.json`), JSON.stringify(state), 'utf-8');

      const result = await status(entry.id);
      expect(result).not.toBeNull();
      expect(result!.namespace).toBe(`test-project-${worktreeId}`);
      expect(result!.services).toHaveLength(1);
      expect(result!.services[0].name).toBe('api');
      expect(result!.services[0].port).toBe(10000);
      expect(result!.services[0].status).toBe('stopped');
      expect(result!.uptime).toBeDefined();
    });
  });

  describe('down', () => {
    it('returns empty results when no state exists', async () => {
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
      const repoPath = createRepoDir('env-down-no-state', yaml);
      const entry = await add(repoPath);

      const result = await down(entry.id);
      expect(result.stopped).toEqual([]);
      expect(result.notRunning).toEqual([]);
    });

    it('logs warning when writeState fails', async () => {
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
      const repoPath = createRepoDir('env-down-write-fail', yaml);
      const entry = await add(repoPath);

      // Write state with a dead process PID
      const stateDir = join(repoPath, '.grove');
      mkdirSync(stateDir, { recursive: true });
      const worktreeId = getWorktreeId();
      const state = {
        namespace: `test-project-${worktreeId}`,
        branch: worktreeId,
        worktreeId,
        ports: {},
        urls: {},
        processes: { 'port-forward-api': { pid: 999999, startedAt: new Date().toISOString() } },
        lastEnsure: new Date().toISOString(),
      };
      writeFileSync(join(stateDir, `${worktreeId}.json`), JSON.stringify(state), 'utf-8');

      // Create a directory where the .tmp file would be written.
      // This causes EISDIR when writeState tries writeFileSync to the .tmp path,
      // without interfering with lock acquisition.
      const tmpPath = join(stateDir, `${worktreeId}.json.tmp`);
      mkdirSync(tmpPath, { recursive: true });
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        const result = await down(entry.id);
        expect(result.notRunning).toContain('port-forward-api');
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('could not save state after stop'),
        );
      } finally {
        rmSync(tmpPath, { recursive: true, force: true });
        consoleWarnSpy.mockRestore();
      }
    });

    it('reports not-running processes', async () => {
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
      const repoPath = createRepoDir('env-down-not-running', yaml);
      const entry = await add(repoPath);

      // Write state with a non-existent PID
      const stateDir = join(repoPath, '.grove');
      mkdirSync(stateDir, { recursive: true });
      const worktreeId = getWorktreeId();
      const state = {
        namespace: `test-project-${worktreeId}`,
        branch: worktreeId,
        worktreeId,
        ports: {},
        urls: {},
        processes: { 'port-forward-api': { pid: 999999, startedAt: new Date().toISOString() } },
        lastEnsure: new Date().toISOString(),
      };
      writeFileSync(join(stateDir, `${worktreeId}.json`), JSON.stringify(state), 'utf-8');

      const result = await down(entry.id);
      expect(result.notRunning).toContain('port-forward-api');
    });
  });
});
