import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `grove-api-config-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add } = await import('../api/repo.js');
const { load, loadWorkspaceConfig } = await import('./config.js');
const { ConfigNotFoundError, ConfigValidationError, RepoNotFoundError } = await import('./errors.js');
const { asRepoId } = await import('./identity.js');

function createRepoDir(name: string, groveYaml?: string): string {
  const repoPath = join(testDir, 'repos', name);
  mkdirSync(repoPath, { recursive: true });
  if (groveYaml) {
    writeFileSync(join(repoPath, '.grove.yaml'), groveYaml, 'utf-8');
  }
  return repoPath;
}

describe('config API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('loads valid config by RepoId', async () => {
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
      const repoPath = createRepoDir('valid-config', yaml);
      const entry = await add(repoPath);

      const config = await load(entry.id);
      expect(config.project.name).toBe('test-project');
      expect(config.services[0].name).toBe('api');
      expect(config.repoRoot).toBe(repoPath);
    });

    it('throws ConfigNotFoundError when .grove.yaml is missing', async () => {
      const repoPath = createRepoDir('no-config');
      const entry = await add(repoPath);

      await expect(load(entry.id)).rejects.toThrow(ConfigNotFoundError);
    });

    it('throws ConfigValidationError for invalid config', async () => {
      const yaml = `invalid: true`;
      const repoPath = createRepoDir('invalid-config', yaml);
      const entry = await add(repoPath);

      await expect(load(entry.id)).rejects.toThrow(ConfigValidationError);
    });

    it('throws RepoNotFoundError for unknown ID', async () => {
      await expect(load(asRepoId('repo_nonexistent1'))).rejects.toThrow(RepoNotFoundError);
    });
  });

  describe('loadWorkspaceConfig', () => {
    it('returns workspace config when present', async () => {
      const yaml = `
workspace:
  repos:
    - path: child-repo
`;
      const repoPath = createRepoDir('ws-config', yaml);
      const entry = await add(repoPath);

      const wsConfig = await loadWorkspaceConfig(entry.id);
      expect(wsConfig).not.toBeNull();
      expect(wsConfig!.repos).toHaveLength(1);
      expect(wsConfig!.repos[0].path).toBe('child-repo');
    });

    it('returns null when no workspace section', async () => {
      const yaml = `project:\n  name: test`;
      const repoPath = createRepoDir('no-ws-config', yaml);
      const entry = await add(repoPath);

      const wsConfig = await loadWorkspaceConfig(entry.id);
      expect(wsConfig).toBeNull();
    });

    it('returns null when no .grove.yaml', async () => {
      const repoPath = createRepoDir('no-yaml');
      const entry = await add(repoPath);

      const wsConfig = await loadWorkspaceConfig(entry.id);
      expect(wsConfig).toBeNull();
    });
  });
});
