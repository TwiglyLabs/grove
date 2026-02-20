import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `grove-api-testing-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add } = await import('../repo/api.js');
const { getTestHistory } = await import('./testing.js');

function createRepoDir(name: string, groveYaml?: string): string {
  const repoPath = join(testDir, 'repos', name);
  mkdirSync(repoPath, { recursive: true });
  if (groveYaml) {
    writeFileSync(join(repoPath, '.grove.yaml'), groveYaml, 'utf-8');
  }
  return repoPath;
}

const baseYaml = `
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

describe('testing API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getTestHistory', () => {
    it('returns empty array when no history exists', async () => {
      const repoPath = createRepoDir('testing-no-history', baseYaml);
      const entry = await add(repoPath);

      const history = await getTestHistory(entry.id);
      expect(history).toEqual([]);
    });

    it('reads archived test results', async () => {
      const repoPath = createRepoDir('testing-with-history', baseYaml);
      const entry = await add(repoPath);

      // Create history directory with a result
      const historyDir = join(repoPath, '.grove', 'test-history');
      const entryDir = join(historyDir, '2024-01-15T10-30-00-api');
      mkdirSync(entryDir, { recursive: true });

      const testResult = {
        run: { id: 'api-default-123', platform: 'api', suite: 'default', duration: '5.00s', result: 'pass' },
        environment: { worktree: 'main', namespace: 'test-ns' },
        tests: { passed: 10, failed: 0, skipped: 0, total: 10 },
        failures: [],
        artifacts: { screenshots: '', videos: '', reports: '' },
        logs: { stdout: '', stderr: '' },
      };
      writeFileSync(join(entryDir, 'results.json'), JSON.stringify(testResult), 'utf-8');

      const history = await getTestHistory(entry.id);
      expect(history).toHaveLength(1);
      expect(history[0].run.platform).toBe('api');
      expect(history[0].tests.passed).toBe(10);
    });

    it('filters by platform', async () => {
      const repoPath = createRepoDir('testing-filter-platform', baseYaml);
      const entry = await add(repoPath);

      const historyDir = join(repoPath, '.grove', 'test-history');

      // Create API result
      const apiDir = join(historyDir, '2024-01-15T10-30-00-api');
      mkdirSync(apiDir, { recursive: true });
      writeFileSync(join(apiDir, 'results.json'), JSON.stringify({
        run: { id: '1', platform: 'api', suite: 'default', duration: '1s', result: 'pass' },
        environment: { worktree: 'main', namespace: 'ns' },
        tests: { passed: 1, failed: 0, skipped: 0, total: 1 },
        failures: [],
        artifacts: {},
        logs: { stdout: '', stderr: '' },
      }), 'utf-8');

      // Create mobile result
      const mobileDir = join(historyDir, '2024-01-15T11-00-00-mobile');
      mkdirSync(mobileDir, { recursive: true });
      writeFileSync(join(mobileDir, 'results.json'), JSON.stringify({
        run: { id: '2', platform: 'mobile', suite: 'default', duration: '2s', result: 'pass' },
        environment: { worktree: 'main', namespace: 'ns' },
        tests: { passed: 5, failed: 0, skipped: 0, total: 5 },
        failures: [],
        artifacts: {},
        logs: { stdout: '', stderr: '' },
      }), 'utf-8');

      const apiHistory = await getTestHistory(entry.id, 'api');
      expect(apiHistory).toHaveLength(1);
      expect(apiHistory[0].run.platform).toBe('api');

      const mobileHistory = await getTestHistory(entry.id, 'mobile');
      expect(mobileHistory).toHaveLength(1);
      expect(mobileHistory[0].run.platform).toBe('mobile');
    });
  });
});
