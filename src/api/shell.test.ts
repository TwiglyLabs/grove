import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { sanitizeBranchName } from '../sanitize.js';

const testDir = join(tmpdir(), `grove-api-shell-test-${process.pid}`);

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

const { add } = await import('./repo.js');
const { getShellCommand } = await import('./shell.js');
const { EnvironmentNotRunningError } = await import('../shared/errors.js');

function createRepoDir(name: string, groveYaml?: string): string {
  const repoPath = join(testDir, 'repos', name);
  mkdirSync(repoPath, { recursive: true });
  if (groveYaml) {
    writeFileSync(join(repoPath, '.grove.yaml'), groveYaml, 'utf-8');
  }
  return repoPath;
}

describe('shell API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('getShellCommand', () => {
    it('throws EnvironmentNotRunningError when no state exists', async () => {
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
utilities:
  shellTargets:
    - name: api
      shell: /bin/bash
`;
      const repoPath = createRepoDir('shell-no-state', yaml);
      const entry = await add(repoPath);

      await expect(getShellCommand(entry.id, 'api')).rejects.toThrow(EnvironmentNotRunningError);
    });

    it('throws for unknown shell target', async () => {
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
utilities:
  shellTargets:
    - name: api
      shell: /bin/bash
`;
      const repoPath = createRepoDir('shell-unknown-target', yaml);
      const entry = await add(repoPath);

      // Write state file
      const stateDir = join(repoPath, '.grove');
      mkdirSync(stateDir, { recursive: true });
      const worktreeId = getWorktreeId();
      writeFileSync(join(stateDir, `${worktreeId}.json`), JSON.stringify({
        namespace: `test-project-${worktreeId}`,
        branch: worktreeId,
        worktreeId,
        ports: {},
        urls: {},
        processes: {},
        lastEnsure: new Date().toISOString(),
      }), 'utf-8');

      await expect(getShellCommand(entry.id, 'nonexistent')).rejects.toThrow('Unknown shell target');
    });
  });
});
