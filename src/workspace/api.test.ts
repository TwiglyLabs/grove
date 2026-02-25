import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceState } from './types.js';
import type { RepoId, WorkspaceId } from '../shared/identity.js';

// --- Hoisted mocks ---

const {
  mockResolveRepoPath,
  mockGetRepo,
  mockInternalCreate,
  mockInternalList,
  mockInternalGetStatus,
  mockInternalSync,
  mockInternalClose,
  mockInternalReadState,
  mockFindWorkspaceByBranch,
  mockDeleteWorkspaceState,
  mockLoadConfig,
  mockReadEnvState,
  mockSanitizeBranchName,
  mockRealpath,
  InternalConflictError,
} = vi.hoisted(() => {
  class _InternalConflictError extends Error {
    conflicted: string;
    files: string[];
    resolved: string[];
    constructor(message: string, conflicted: string, files: string[], resolved: string[] = []) {
      super(message);
      this.conflicted = conflicted;
      this.files = files;
      this.resolved = resolved;
    }
  }
  return {
    mockResolveRepoPath: vi.fn(),
    mockGetRepo: vi.fn(),
    mockInternalCreate: vi.fn(),
    mockInternalList: vi.fn(),
    mockInternalGetStatus: vi.fn(),
    mockInternalSync: vi.fn(),
    mockInternalClose: vi.fn(),
    mockInternalReadState: vi.fn(),
    mockFindWorkspaceByBranch: vi.fn(),
    mockDeleteWorkspaceState: vi.fn(),
    mockLoadConfig: vi.fn(),
    mockReadEnvState: vi.fn(),
    mockSanitizeBranchName: vi.fn(),
    mockRealpath: vi.fn(async (p: string) => p),
    InternalConflictError: _InternalConflictError,
  };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    realpath: mockRealpath,
  };
});

vi.mock('../repo/api.js', () => ({
  resolveRepoPath: mockResolveRepoPath,
  get: mockGetRepo,
}));

vi.mock('./create.js', () => ({
  createWorkspace: mockInternalCreate,
}));

vi.mock('./status.js', () => ({
  listWorkspaces: mockInternalList,
  getWorkspaceStatus: mockInternalGetStatus,
}));

vi.mock('./sync.js', () => ({
  syncWorkspace: mockInternalSync,
  ConflictError: InternalConflictError,
}));

vi.mock('./close.js', () => ({
  closeWorkspace: mockInternalClose,
}));

vi.mock('./state.js', () => ({
  readWorkspaceState: mockInternalReadState,
  findWorkspaceByBranch: mockFindWorkspaceByBranch,
  deleteWorkspaceState: mockDeleteWorkspaceState,
}));

vi.mock('../config.js', () => ({
  loadConfig: mockLoadConfig,
}));

vi.mock('../environment/state.js', () => ({
  readState: mockReadEnvState,
}));

vi.mock('./sanitize.js', () => ({
  sanitizeBranchName: mockSanitizeBranchName,
}));

import { create, list, getStatus, sync, close, resolvePath, readState, findOrphanedWorktrees, cleanOrphanedWorktrees, describe as describeWorkspace } from './api.js';
import { WorkspaceNotFoundError, ConflictError } from '../shared/errors.js';

// --- Helpers ---

const testRepoId = 'repo_abc123xyz' as RepoId;
const testWsId = 'project-feature-x' as WorkspaceId;

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    version: 1,
    id: 'project-feature-x',
    status: 'active',
    branch: 'feature-x',
    createdAt: '2026-02-14T10:00:00Z',
    updatedAt: '2026-02-14T10:00:00Z',
    root: '/home/user/worktrees/project/feature-x',
    source: '/repos/project',
    repos: [
      {
        name: 'project',
        role: 'parent',
        source: '/repos/project',
        worktree: '/home/user/worktrees/project/feature-x',
        parentBranch: 'main',
      },
    ],
    sync: null,
    ...overrides,
  };
}

// --- Tests ---

describe('workspace api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('resolves RepoId to path, calls internalCreate, brands result', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
      });

      const result = await create('feature-x', { from: testRepoId });

      expect(mockResolveRepoPath).toHaveBeenCalledWith(testRepoId);
      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', { from: '/repos/project' });
      expect(result).toEqual({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
      });
    });

    it('passes through setup and hookResult from internal create', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
        setup: [
          { command: 'npm install', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100 },
        ],
        hookResult: {
          command: './scripts/post-create.sh',
          exitCode: 0,
          stdout: 'done',
          stderr: '',
          durationMs: 50,
        },
      });

      const result = await create('feature-x', { from: testRepoId });

      expect(result.setup).toHaveLength(1);
      expect(result.setup![0].command).toBe('npm install');
      expect(result.hookResult).toMatchObject({
        command: './scripts/post-create.sh',
        exitCode: 0,
      });
    });

    it('propagates RepoNotFoundError from resolveRepoPath', async () => {
      mockResolveRepoPath.mockRejectedValue(new Error('Repo not found: repo_bad'));

      await expect(create('feature-x', { from: 'repo_bad' as RepoId }))
        .rejects.toThrow('Repo not found');
    });

    it('repos with RepoId entries → resolved via registry and passed as childRepos', async () => {
      mockResolveRepoPath
        .mockResolvedValueOnce('/repos/project')  // from
        .mockResolvedValueOnce('/repos/api');      // RepoId resolution
      mockGetRepo.mockResolvedValue({
        id: 'repo_api123' as RepoId,
        name: 'api',
        path: '/repos/api',
        addedAt: '2026-01-01',
      });
      mockRealpath.mockImplementation(async (p: string) => p);
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project', 'api'],
      });

      await create('feature-x', {
        from: testRepoId,
        repos: ['repo_api123' as RepoId],
      });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [{ path: '/repos/api', name: 'api' }],
      });
    });

    it('repos with RepoSpec absolute path → used as-is', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project', 'external'],
      });

      await create('feature-x', {
        from: testRepoId,
        repos: [{ path: '/other/external' }],
      });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [{ path: '/other/external', name: 'external' }],
      });
    });

    it('repos with RepoSpec relative path → resolved against parent root', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project', 'libs/shared'],
      });

      await create('feature-x', {
        from: testRepoId,
        repos: [{ path: 'libs/shared' }],
      });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [{ path: '/repos/project/libs/shared', name: 'libs/shared' }],
      });
    });

    it('repos with explicit name → name used for worktree directory', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project', 'my-api'],
      });

      await create('feature-x', {
        from: testRepoId,
        repos: [{ path: '/repos/api-service', name: 'my-api' }],
      });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [{ path: '/repos/api-service', name: 'my-api' }],
      });
    });

    it('repos containing parent repo → silently deduplicated', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project', 'api'],
      });

      await create('feature-x', {
        from: testRepoId,
        repos: [
          { path: '/repos/project' },  // same as parent — should be skipped
          { path: '/repos/api' },
        ],
      });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [{ path: '/repos/api', name: 'api' }],
      });
    });

    it('repos with duplicate paths → throws', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);

      await expect(create('feature-x', {
        from: testRepoId,
        repos: [
          { path: '/repos/api' },
          { path: '/repos/api' },
        ],
      })).rejects.toThrow('Duplicate repo path');
    });

    it('repos with duplicate names → throws with disambiguation hint', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);

      await expect(create('feature-x', {
        from: testRepoId,
        repos: [
          { path: '/repos/org-a/shared' },
          { path: '/repos/org-b/shared' },
        ],
      })).rejects.toThrow(/Duplicate repo name.*name.*disambiguate/);
    });

    it('repos with non-existent RepoId → throws RepoNotFoundError', async () => {
      mockResolveRepoPath
        .mockResolvedValueOnce('/repos/project')  // from
        .mockRejectedValueOnce(new Error('Repo not found: repo_doesnotexist'));  // RepoId in repos

      await expect(create('feature-x', {
        from: testRepoId,
        repos: ['repo_doesnotexist' as RepoId],
      })).rejects.toThrow('Repo not found: repo_doesnotexist');

      expect(mockInternalCreate).not.toHaveBeenCalled();
    });

    it('repos: [] → overrides config, passes empty childRepos', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
      });

      await create('feature-x', {
        from: testRepoId,
        repos: [],
      });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [],
      });
    });

    it('repos with Windows-style absolute path → treated as absolute, not relative', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockRealpath.mockImplementation(async (p: string) => p);
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project', 'winrepo'],
      });

      // Windows paths need explicit name since basename doesn't parse backslashes on POSIX
      await create('feature-x', {
        from: testRepoId,
        repos: [{ path: 'C:\\repos\\winrepo', name: 'winrepo' }],
      });

      // Key assertion: path is used as-is (not resolved against parent root)
      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
        childRepos: [{ path: 'C:\\repos\\winrepo', name: 'winrepo' }],
      });
    });

    it('repos omitted → no childRepos passed to internal create', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
      });

      await create('feature-x', { from: testRepoId });

      expect(mockInternalCreate).toHaveBeenCalledWith('feature-x', {
        from: '/repos/project',
      });
    });
  });

  describe('list', () => {
    it('returns all workspaces with branded IDs', async () => {
      mockInternalList.mockResolvedValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
        { id: 'ws-2', branch: 'feat-b', status: 'active', age: '1d', root: '/b', missing: false },
      ]);

      const result = await list();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ws-1');
      expect(result[1].id).toBe('ws-2');
    });

    it('filters by repo when option provided', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalList.mockResolvedValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
        { id: 'ws-2', branch: 'feat-b', status: 'active', age: '1d', root: '/b', missing: false },
      ]);
      // ws-1 matches the repo source, ws-2 does not
      mockInternalReadState
        .mockResolvedValueOnce(makeState({ id: 'ws-1', source: '/repos/project' }))
        .mockResolvedValueOnce(makeState({ id: 'ws-2', source: '/repos/other' }));

      const result = await list({ repo: testRepoId });

      expect(mockResolveRepoPath).toHaveBeenCalledWith(testRepoId);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ws-1');
    });

    it('returns empty when no workspaces match repo filter', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalList.mockResolvedValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
      ]);
      mockInternalReadState.mockResolvedValue(makeState({ source: '/repos/other' }));

      const result = await list({ repo: testRepoId });
      expect(result).toHaveLength(0);
    });
  });

  describe('getStatus', () => {
    it('passes workspace ID through and brands result', async () => {
      mockInternalGetStatus.mockResolvedValue({
        id: 'project-feature-x',
        status: 'active',
        branch: 'feature-x',
        repos: [{ name: 'project', role: 'parent', dirty: 2, commits: 3, syncStatus: null }],
      });

      const result = await getStatus(testWsId);

      expect(mockInternalGetStatus).toHaveBeenCalledWith(testWsId);
      expect(result.id).toBe('project-feature-x');
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].dirty).toBe(2);
    });
  });

  describe('sync', () => {
    it('resolves workspace, calls internalSync, returns result', async () => {
      mockInternalReadState.mockResolvedValue(makeState());

      mockInternalSync.mockResolvedValue({
        synced: ['project'],
        details: [{ name: 'project', status: 'synced' }],
      });

      const result = await sync(testWsId);

      expect(mockInternalSync).toHaveBeenCalledWith('feature-x');
      expect(result).toEqual({
        synced: ['project'],
        details: [{ name: 'project', status: 'synced' }],
      });
    });

    it('converts internal ConflictError to shared ConflictError', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalSync.mockRejectedValue(
        new InternalConflictError('conflict', 'project', ['file.ts']),
      );

      try {
        await sync(testWsId);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as ConflictError).repo).toBe('project');
        expect((error as ConflictError).files).toEqual(['file.ts']);
      }
    });

    it('throws WorkspaceNotFoundError when workspace does not exist', async () => {
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(null);

      await expect(sync(testWsId)).rejects.toThrow(WorkspaceNotFoundError);
    });

    it('falls back to findWorkspaceByBranch when ID lookup fails', async () => {
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(makeState());
      mockInternalSync.mockResolvedValue({ synced: ['project'], details: [] });

      await sync(testWsId);

      expect(mockFindWorkspaceByBranch).toHaveBeenCalledWith(testWsId);
      expect(mockInternalSync).toHaveBeenCalledWith('feature-x');
    });
  });

  describe('close', () => {
    it('calls internalClose with merge mode', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalClose.mockResolvedValue(undefined);

      const result = await close(testWsId, 'merge');

      expect(mockInternalClose).toHaveBeenCalledWith('feature-x', 'merge', expect.objectContaining({ dryRun: undefined }));
      expect(result).toEqual({ branch: 'feature-x', mode: 'merge' });
    });

    it('calls internalClose with discard mode', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalClose.mockResolvedValue(undefined);

      const result = await close(testWsId, 'discard');

      expect(mockInternalClose).toHaveBeenCalledWith('feature-x', 'discard', expect.objectContaining({ dryRun: undefined }));
      expect(result).toEqual({ branch: 'feature-x', mode: 'discard' });
    });

    it('returns dry-run result when dryRun option is set', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      const dryRunResult = { repos: [{ name: 'project', commits: 5 }] };
      mockInternalClose.mockResolvedValue(dryRunResult);

      const result = await close(testWsId, 'merge', { dryRun: true });

      expect(mockInternalClose).toHaveBeenCalledWith('feature-x', 'merge', expect.objectContaining({ dryRun: true }));
      expect(result).toEqual(dryRunResult);
    });

    it('throws WorkspaceNotFoundError when workspace does not exist', async () => {
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(null);

      await expect(close(testWsId, 'merge')).rejects.toThrow(WorkspaceNotFoundError);
    });
  });

  describe('resolvePath', () => {
    it('returns workspace root path', async () => {
      mockInternalReadState.mockResolvedValue(makeState());

      expect(await resolvePath(testWsId)).toBe('/home/user/worktrees/project/feature-x');
    });

    it('throws WorkspaceNotFoundError when workspace does not exist', async () => {
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(null);

      await expect(resolvePath(testWsId)).rejects.toThrow(WorkspaceNotFoundError);
    });
  });

  describe('readState', () => {
    it('returns state when found by ID', async () => {
      const state = makeState();
      mockInternalReadState.mockResolvedValue(state);

      expect(await readState(testWsId)).toEqual(state);
    });

    it('falls back to branch lookup when ID not found', async () => {
      const state = makeState();
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(state);

      expect(await readState(testWsId)).toEqual(state);
    });

    it('returns null when workspace not found by either method', async () => {
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(null);

      expect(await readState(testWsId)).toBeNull();
    });
  });

  describe('findOrphanedWorktrees', () => {
    it('returns empty array when no workspaces exist', async () => {
      mockInternalList.mockResolvedValue([]);

      const result = await findOrphanedWorktrees();

      expect(result).toEqual([]);
    });

    it('returns empty array when all workspaces have existing roots', async () => {
      mockInternalList.mockResolvedValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
        { id: 'ws-2', branch: 'feat-b', status: 'active', age: '1d', root: '/b', missing: false },
      ]);

      const result = await findOrphanedWorktrees();

      expect(result).toEqual([]);
    });

    it('detects workspaces whose root directory is missing', async () => {
      mockInternalList.mockResolvedValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
        { id: 'ws-2', branch: 'feat-b', status: 'active', age: '1d', root: '/gone', missing: true },
      ]);

      const result = await findOrphanedWorktrees();

      expect(result).toEqual([{
        path: '/gone',
        workspaceId: 'ws-2',
      }]);
    });

    it('detects multiple orphaned worktrees', async () => {
      mockInternalList.mockResolvedValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/gone-a', missing: true },
        { id: 'ws-2', branch: 'feat-b', status: 'active', age: '1d', root: '/gone-b', missing: true },
      ]);

      const result = await findOrphanedWorktrees();

      expect(result).toHaveLength(2);
    });
  });

  describe('cleanOrphanedWorktrees', () => {
    it('deletes workspace state files for orphaned entries', async () => {
      const entries = [
        { path: '/gone', workspaceId: 'ws-2' },
      ];

      await cleanOrphanedWorktrees(entries);

      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('ws-2');
    });

    it('continues when deletion fails', async () => {
      mockDeleteWorkspaceState.mockRejectedValue(new Error('Failed'));

      const entries = [
        { path: '/gone-a', workspaceId: 'ws-1' },
        { path: '/gone-b', workspaceId: 'ws-2' },
      ];

      await expect(cleanOrphanedWorktrees(entries)).resolves.not.toThrow();
      expect(mockDeleteWorkspaceState).toHaveBeenCalledTimes(2);
    });
  });

  describe('describe', () => {
    const fullConfig = {
      project: { name: 'myproject', cluster: 'local', clusterType: 'kind' },
      helm: { chart: './helm', release: 'myproject', valuesFiles: ['values.yaml'] },
      services: [
        { name: 'api', portForward: { remotePort: 8080 }, build: { image: 'api', dockerfile: 'Dockerfile' } },
        { name: 'worker', build: { image: 'worker', dockerfile: 'Dockerfile' } },
      ],
      frontends: [
        { name: 'webapp', command: 'npm run dev', cwd: 'packages/webapp' },
      ],
      testing: {
        mobile: { runner: 'maestro', basePath: 'e2e' },
        webapp: { runner: 'vitest', cwd: 'packages/webapp' },
        api: { runner: 'jest', cwd: 'packages/api' },
        historyDir: '.grove/test-history',
        historyLimit: 10,
        defaultTimeout: 300000,
      },
      utilities: {
        shellTargets: [
          { name: 'api', podSelector: 'app=api' },
          { name: 'worker', podSelector: 'app=worker' },
        ],
      },
      portBlockSize: 3,
      repoRoot: '/repos/project',
    };

    const envState = {
      namespace: 'myproject-feature-x',
      branch: 'feature-x',
      worktreeId: 'feature-x',
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      processes: {},
      lastEnsure: '2026-02-14T10:00:00Z',
    };

    beforeEach(() => {
      mockSanitizeBranchName.mockReturnValue('feature-x');
    });

    it('composes full descriptor from workspace state, env state, and config', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue(fullConfig);
      mockReadEnvState.mockReturnValue(envState);

      const result = await describeWorkspace(testWsId);

      expect(result.workspace).toEqual({
        id: 'project-feature-x',
        branch: 'feature-x',
        repos: [{ name: 'project', role: 'parent', path: '/home/user/worktrees/project/feature-x' }],
      });
      expect(result.services).toEqual([
        { name: 'api', url: 'http://127.0.0.1:10000', port: 10000 },
      ]);
      expect(result.frontends).toEqual([
        { name: 'webapp', url: 'http://127.0.0.1:10001', cwd: 'packages/webapp' },
      ]);
      expect(result.testing).toEqual({
        commands: { mobile: 'maestro', webapp: 'vitest', api: 'jest' },
      });
      expect(result.shell).toEqual({
        targets: ['api', 'worker'],
      });
    });

    it('loads config from workspace source path', async () => {
      mockInternalReadState.mockResolvedValue(makeState({ source: '/repos/myrepo' }));
      mockLoadConfig.mockReturnValue(fullConfig);
      mockReadEnvState.mockReturnValue(envState);

      await describeWorkspace(testWsId);

      expect(mockLoadConfig).toHaveBeenCalledWith('/repos/myrepo');
    });

    it('passes sanitized branch name as worktreeId to readEnvState', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue(fullConfig);
      mockReadEnvState.mockReturnValue(envState);
      mockSanitizeBranchName.mockReturnValue('feat--my-branch');

      await describeWorkspace(testWsId);

      expect(mockSanitizeBranchName).toHaveBeenCalledWith('feature-x');
      expect(mockReadEnvState).toHaveBeenCalledWith(fullConfig, 'feat--my-branch');
    });

    it('returns empty URLs and zero ports when environment is not running', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue(fullConfig);
      mockReadEnvState.mockReturnValue(null);

      const result = await describeWorkspace(testWsId);

      expect(result.services).toEqual([
        { name: 'api', url: '', port: 0 },
      ]);
      expect(result.frontends).toEqual([
        { name: 'webapp', url: '', cwd: 'packages/webapp' },
      ]);
    });

    it('returns empty testing commands when config has no testing section', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue({ ...fullConfig, testing: undefined });
      mockReadEnvState.mockReturnValue(envState);

      const result = await describeWorkspace(testWsId);

      expect(result.testing).toEqual({ commands: {} });
    });

    it('returns empty shell targets when config has no utilities', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue({ ...fullConfig, utilities: undefined });
      mockReadEnvState.mockReturnValue(envState);

      const result = await describeWorkspace(testWsId);

      expect(result.shell).toEqual({ targets: [] });
    });

    it('only includes services with portForward in services list', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue(fullConfig);
      mockReadEnvState.mockReturnValue(envState);

      const result = await describeWorkspace(testWsId);

      // 'worker' has no portForward, should be excluded
      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('api');
    });

    it('maps multiple repos including parent and child', async () => {
      const multiRepoState = makeState({
        repos: [
          { name: 'project', role: 'parent', source: '/repos/project', worktree: '/home/user/worktrees/project/feature-x', parentBranch: 'main' },
          { name: 'public', role: 'child', source: '/repos/public', worktree: '/home/user/worktrees/project/feature-x/public', parentBranch: 'main' },
          { name: 'cloud', role: 'child', source: '/repos/cloud', worktree: '/home/user/worktrees/project/feature-x/cloud', parentBranch: 'main' },
        ],
      });
      mockInternalReadState.mockResolvedValue(multiRepoState);
      mockLoadConfig.mockReturnValue(fullConfig);
      mockReadEnvState.mockReturnValue(envState);

      const result = await describeWorkspace(testWsId);

      expect(result.workspace.repos).toEqual([
        { name: 'project', role: 'parent', path: '/home/user/worktrees/project/feature-x' },
        { name: 'public', role: 'child', path: '/home/user/worktrees/project/feature-x/public' },
        { name: 'cloud', role: 'child', path: '/home/user/worktrees/project/feature-x/cloud' },
      ]);
    });

    it('includes only configured testing platforms in commands', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue({
        ...fullConfig,
        testing: {
          mobile: { runner: 'maestro', basePath: 'e2e' },
          historyDir: '.grove/test-history',
          historyLimit: 10,
          defaultTimeout: 300000,
        },
      });
      mockReadEnvState.mockReturnValue(envState);

      const result = await describeWorkspace(testWsId);

      expect(result.testing.commands).toEqual({ mobile: 'maestro' });
    });

    it('maps multiple services with portForward', async () => {
      const multiServiceConfig = {
        ...fullConfig,
        services: [
          { name: 'api', portForward: { remotePort: 8080 }, build: { image: 'api', dockerfile: 'Dockerfile' } },
          { name: 'auth', portForward: { remotePort: 9090 }, build: { image: 'auth', dockerfile: 'Dockerfile' } },
          { name: 'worker', build: { image: 'worker', dockerfile: 'Dockerfile' } },
        ],
      };
      const multiServiceEnvState = {
        ...envState,
        ports: { api: 10000, auth: 10001, webapp: 10002 },
        urls: { api: 'http://127.0.0.1:10000', auth: 'http://127.0.0.1:10001', webapp: 'http://127.0.0.1:10002' },
      };
      mockInternalReadState.mockResolvedValue(makeState());
      mockLoadConfig.mockReturnValue(multiServiceConfig);
      mockReadEnvState.mockReturnValue(multiServiceEnvState);

      const result = await describeWorkspace(testWsId);

      expect(result.services).toEqual([
        { name: 'api', url: 'http://127.0.0.1:10000', port: 10000 },
        { name: 'auth', url: 'http://127.0.0.1:10001', port: 10001 },
      ]);
    });

    it('throws WorkspaceNotFoundError when workspace does not exist', async () => {
      mockInternalReadState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(null);

      await expect(describeWorkspace(testWsId)).rejects.toThrow(WorkspaceNotFoundError);
    });
  });
});
