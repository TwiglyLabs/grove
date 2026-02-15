import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `grove-api-logs-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add } = await import('./repo.js');
const { readLogs } = await import('./logs.js');

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

describe('logs API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('readLogs', () => {
    it('returns null when no log file exists', async () => {
      const repoPath = createRepoDir('logs-no-file', baseYaml);
      const entry = await add(repoPath);

      const result = await readLogs(entry.id, 'api');
      expect(result).toBeNull();
    });

    it('reads port-forward log file', async () => {
      const repoPath = createRepoDir('logs-pf', baseYaml);
      const entry = await add(repoPath);

      // Create port-forward log
      const logsDir = join(repoPath, '.grove', 'logs');
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, 'port-forward-api.log'), 'port-forward output', 'utf-8');

      const result = await readLogs(entry.id, 'api');
      expect(result).not.toBeNull();
      expect(result!.service).toBe('api');
      expect(result!.type).toBe('port-forward');
      expect(result!.content).toBe('port-forward output');
    });

    it('reads frontend log file', async () => {
      const repoPath = createRepoDir('logs-frontend', baseYaml);
      const entry = await add(repoPath);

      // Create frontend log
      const logsDir = join(repoPath, '.grove', 'logs');
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, 'webapp.log'), 'frontend output', 'utf-8');

      const result = await readLogs(entry.id, 'webapp');
      expect(result).not.toBeNull();
      expect(result!.service).toBe('webapp');
      expect(result!.type).toBe('frontend');
      expect(result!.content).toBe('frontend output');
    });

    it('prefers port-forward log over frontend log', async () => {
      const repoPath = createRepoDir('logs-prefer-pf', baseYaml);
      const entry = await add(repoPath);

      const logsDir = join(repoPath, '.grove', 'logs');
      mkdirSync(logsDir, { recursive: true });
      writeFileSync(join(logsDir, 'port-forward-api.log'), 'pf output', 'utf-8');
      writeFileSync(join(logsDir, 'api.log'), 'frontend output', 'utf-8');

      const result = await readLogs(entry.id, 'api');
      expect(result!.type).toBe('port-forward');
    });
  });
});
