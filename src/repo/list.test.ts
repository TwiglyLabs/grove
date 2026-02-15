import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { RepoRegistry } from './types.js';
import type { WorkspaceState } from '../workspace/types.js';

const testDir = join(tmpdir(), `grove-repo-list-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { listRepos } = await import('./list.js');

function writeRepoRegistry(registry: RepoRegistry): void {
  const dir = join(testDir, '.grove');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repos.json'), JSON.stringify(registry), 'utf-8');
}

function writeWorkspaceState(state: WorkspaceState): void {
  const dir = join(testDir, '.grove', 'workspaces');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${state.id}.json`), JSON.stringify(state), 'utf-8');
}

function makeWorkspaceState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    version: 1,
    id: 'test-workspace',
    status: 'active',
    branch: 'feature-x',
    createdAt: '2026-02-13T10:00:00Z',
    updatedAt: '2026-02-13T14:00:00Z',
    root: '/tmp/worktrees/myrepo/feature-x',
    source: '/tmp/repos/myrepo',
    repos: [
      {
        name: 'myrepo',
        role: 'parent',
        source: '/tmp/repos/myrepo',
        worktree: '/tmp/worktrees/myrepo/feature-x',
        parentBranch: 'main',
      },
    ],
    sync: null,
    ...overrides,
  };
}

describe('listRepos', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    delete process.env.GROVE_STATE_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns empty list when no repos registered', async () => {
    const result = await listRepos();
    expect(result.repos).toEqual([]);
  });

  it('returns repos sorted alphabetically', async () => {
    writeRepoRegistry({
      version: 1,
      repos: [
        { name: 'zeta', path: '/tmp/zeta', addedAt: '2026-02-14T10:00:00Z' },
        { name: 'alpha', path: '/tmp/alpha', addedAt: '2026-02-14T10:01:00Z' },
      ],
    });

    const result = await listRepos();
    expect(result.repos.map(r => r.name)).toEqual(['alpha', 'zeta']);
  });

  it('marks non-existent paths with exists: false', async () => {
    writeRepoRegistry({
      version: 1,
      repos: [
        { name: 'gone', path: '/nonexistent/path/gone', addedAt: '2026-02-14T10:00:00Z' },
      ],
    });

    const result = await listRepos();
    expect(result.repos[0].exists).toBe(false);
  });

  it('marks existing paths with exists: true', async () => {
    // testDir itself exists
    writeRepoRegistry({
      version: 1,
      repos: [
        { name: 'test', path: testDir, addedAt: '2026-02-14T10:00:00Z' },
      ],
    });

    const result = await listRepos();
    expect(result.repos[0].exists).toBe(true);
  });

  it('joins workspace state with matching repo by source path', async () => {
    const repoPath = '/tmp/repos/myrepo';
    writeRepoRegistry({
      version: 1,
      repos: [
        { name: 'myrepo', path: repoPath, addedAt: '2026-02-14T10:00:00Z' },
      ],
    });
    writeWorkspaceState(makeWorkspaceState({
      id: 'myrepo-feature-x',
      source: repoPath,
      repos: [
        { name: 'myrepo', role: 'parent', source: repoPath, worktree: '/tmp/wt', parentBranch: 'main' },
        { name: 'child', role: 'child', source: '/tmp/child', worktree: '/tmp/wt/child', parentBranch: 'main' },
      ],
    }));

    const result = await listRepos();
    expect(result.repos[0].workspaces).toHaveLength(1);
    expect(result.repos[0].workspaces[0]).toEqual({
      id: 'myrepo-feature-x',
      branch: 'feature-x',
      status: 'active',
      root: '/tmp/worktrees/myrepo/feature-x',
      repoCount: 2,
    });
  });

  it('does not join workspaces with non-matching source', async () => {
    writeRepoRegistry({
      version: 1,
      repos: [
        { name: 'other', path: '/tmp/repos/other', addedAt: '2026-02-14T10:00:00Z' },
      ],
    });
    writeWorkspaceState(makeWorkspaceState({
      source: '/tmp/repos/myrepo',
    }));

    const result = await listRepos();
    expect(result.repos[0].workspaces).toEqual([]);
  });

  it('joins multiple workspaces to same repo', async () => {
    const repoPath = '/tmp/repos/myrepo';
    writeRepoRegistry({
      version: 1,
      repos: [
        { name: 'myrepo', path: repoPath, addedAt: '2026-02-14T10:00:00Z' },
      ],
    });
    writeWorkspaceState(makeWorkspaceState({ id: 'ws-1', source: repoPath, branch: 'feature-a' }));
    writeWorkspaceState(makeWorkspaceState({ id: 'ws-2', source: repoPath, branch: 'feature-b' }));

    const result = await listRepos();
    expect(result.repos[0].workspaces).toHaveLength(2);
  });
});
