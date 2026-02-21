import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceState } from './types.js';
import type { RepoId, WorkspaceId } from '../shared/identity.js';

// --- Hoisted mocks ---

const {
  mockResolveRepoPath,
  mockInternalCreate,
  mockInternalList,
  mockInternalGetStatus,
  mockInternalSync,
  mockInternalClose,
  mockInternalReadState,
  mockFindWorkspaceByBranch,
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
    mockInternalCreate: vi.fn(),
    mockInternalList: vi.fn(),
    mockInternalGetStatus: vi.fn(),
    mockInternalSync: vi.fn(),
    mockInternalClose: vi.fn(),
    mockInternalReadState: vi.fn(),
    mockFindWorkspaceByBranch: vi.fn(),
    InternalConflictError: _InternalConflictError,
  };
});

vi.mock('../repo/api.js', () => ({
  resolveRepoPath: mockResolveRepoPath,
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
}));

import { create, list, getStatus, sync, close, resolvePath, readState } from './api.js';
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

    it('propagates RepoNotFoundError from resolveRepoPath', async () => {
      mockResolveRepoPath.mockRejectedValue(new Error('Repo not found: repo_bad'));

      await expect(create('feature-x', { from: 'repo_bad' as RepoId }))
        .rejects.toThrow('Repo not found');
    });
  });

  describe('list', () => {
    it('returns all workspaces with branded IDs', async () => {
      mockInternalList.mockReturnValue([
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
      mockInternalList.mockReturnValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
        { id: 'ws-2', branch: 'feat-b', status: 'active', age: '1d', root: '/b', missing: false },
      ]);
      // ws-1 matches the repo source, ws-2 does not
      mockInternalReadState
        .mockReturnValueOnce(makeState({ id: 'ws-1', source: '/repos/project' }))
        .mockReturnValueOnce(makeState({ id: 'ws-2', source: '/repos/other' }));

      const result = await list({ repo: testRepoId });

      expect(mockResolveRepoPath).toHaveBeenCalledWith(testRepoId);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ws-1');
    });

    it('returns empty when no workspaces match repo filter', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalList.mockReturnValue([
        { id: 'ws-1', branch: 'feat-a', status: 'active', age: '2h', root: '/a', missing: false },
      ]);
      mockInternalReadState.mockReturnValue(makeState({ source: '/repos/other' }));

      const result = await list({ repo: testRepoId });
      expect(result).toHaveLength(0);
    });
  });

  describe('getStatus', () => {
    it('passes workspace ID through and brands result', () => {
      mockInternalGetStatus.mockReturnValue({
        id: 'project-feature-x',
        status: 'active',
        branch: 'feature-x',
        repos: [{ name: 'project', role: 'parent', dirty: 2, commits: 3, syncStatus: null }],
      });

      const result = getStatus(testWsId);

      expect(mockInternalGetStatus).toHaveBeenCalledWith(testWsId);
      expect(result.id).toBe('project-feature-x');
      expect(result.repos).toHaveLength(1);
      expect(result.repos[0].dirty).toBe(2);
    });
  });

  describe('sync', () => {
    it('resolves workspace, calls internalSync, returns result', async () => {
      mockInternalReadState.mockReturnValue(makeState());

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
      mockInternalReadState.mockReturnValue(makeState());
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
      mockInternalReadState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(null);

      await expect(sync(testWsId)).rejects.toThrow(WorkspaceNotFoundError);
    });

    it('falls back to findWorkspaceByBranch when ID lookup fails', async () => {
      mockInternalReadState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(makeState());
      mockInternalSync.mockResolvedValue({ synced: ['project'], details: [] });

      await sync(testWsId);

      expect(mockFindWorkspaceByBranch).toHaveBeenCalledWith(testWsId);
      expect(mockInternalSync).toHaveBeenCalledWith('feature-x');
    });
  });

  describe('close', () => {
    it('calls internalClose with merge mode', async () => {
      mockInternalReadState.mockReturnValue(makeState());
      mockInternalClose.mockResolvedValue(undefined);

      const result = await close(testWsId, 'merge');

      expect(mockInternalClose).toHaveBeenCalledWith('feature-x', 'merge', { dryRun: undefined });
      expect(result).toEqual({ branch: 'feature-x', mode: 'merge' });
    });

    it('calls internalClose with discard mode', async () => {
      mockInternalReadState.mockReturnValue(makeState());
      mockInternalClose.mockResolvedValue(undefined);

      const result = await close(testWsId, 'discard');

      expect(mockInternalClose).toHaveBeenCalledWith('feature-x', 'discard', { dryRun: undefined });
      expect(result).toEqual({ branch: 'feature-x', mode: 'discard' });
    });

    it('returns dry-run result when dryRun option is set', async () => {
      mockInternalReadState.mockReturnValue(makeState());
      const dryRunResult = { repos: [{ name: 'project', commits: 5 }] };
      mockInternalClose.mockResolvedValue(dryRunResult);

      const result = await close(testWsId, 'merge', { dryRun: true });

      expect(mockInternalClose).toHaveBeenCalledWith('feature-x', 'merge', { dryRun: true });
      expect(result).toEqual(dryRunResult);
    });

    it('throws WorkspaceNotFoundError when workspace does not exist', async () => {
      mockInternalReadState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(null);

      await expect(close(testWsId, 'merge')).rejects.toThrow(WorkspaceNotFoundError);
    });
  });

  describe('resolvePath', () => {
    it('returns workspace root path', () => {
      mockInternalReadState.mockReturnValue(makeState());

      expect(resolvePath(testWsId)).toBe('/home/user/worktrees/project/feature-x');
    });

    it('throws WorkspaceNotFoundError when workspace does not exist', () => {
      mockInternalReadState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(null);

      expect(() => resolvePath(testWsId)).toThrow(WorkspaceNotFoundError);
    });
  });

  describe('readState', () => {
    it('returns state when found by ID', () => {
      const state = makeState();
      mockInternalReadState.mockReturnValue(state);

      expect(readState(testWsId)).toEqual(state);
    });

    it('falls back to branch lookup when ID not found', () => {
      const state = makeState();
      mockInternalReadState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(state);

      expect(readState(testWsId)).toEqual(state);
    });

    it('returns null when workspace not found by either method', () => {
      mockInternalReadState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(null);

      expect(readState(testWsId)).toBeNull();
    });
  });
});
