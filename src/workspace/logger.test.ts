/**
 * Tests verifying Logger injection into workspace API operations.
 *
 * These tests verify that when a Logger is passed via options to workspace.create(),
 * workspace.sync(), and workspace.close(), the logger child is called with appropriate messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkspaceState } from './types.js';
import type { RepoId, WorkspaceId } from '../shared/identity.js';
import type { Logger } from '@twiglylabs/log';

// --- Hoisted mocks ---

const {
  mockResolveRepoPath,
  mockInternalCreate,
  mockInternalReadState,
  mockFindWorkspaceByBranch,
  mockInternalSync,
  mockInternalClose,
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
    mockInternalReadState: vi.fn(),
    mockFindWorkspaceByBranch: vi.fn(),
    mockInternalSync: vi.fn(),
    mockInternalClose: vi.fn(),
    InternalConflictError: _InternalConflictError,
  };
});

vi.mock('../repo/api.js', () => ({
  resolveRepoPath: mockResolveRepoPath,
  get: vi.fn(),
}));

vi.mock('./create.js', () => ({
  createWorkspace: mockInternalCreate,
}));

vi.mock('./status.js', () => ({
  listWorkspaces: vi.fn().mockResolvedValue([]),
  getWorkspaceStatus: vi.fn(),
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
  deleteWorkspaceState: vi.fn(),
}));

vi.mock('../config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    project: { name: 'proj', cluster: 'local', clusterType: 'kind' },
    helm: { chart: '.', release: 'proj', valuesFiles: [] },
    services: [],
    portBlockSize: 1,
    repoRoot: '/repos/project',
  }),
}));

vi.mock('../environment/state.js', () => ({
  readState: vi.fn().mockReturnValue(null),
}));

vi.mock('./sanitize.js', () => ({
  sanitizeBranchName: vi.fn().mockReturnValue('feature-x'),
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    realpath: vi.fn(async (p: string) => p),
  };
});

import { create, sync, close } from './api.js';

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

function makeMockLogger(): Logger {
  const child: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => child),
  };
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => child),
  };
}

// --- Tests ---

describe('workspace API logger injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create with logger', () => {
    it('calls logger.info when workspace is created', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
      });

      const logger = makeMockLogger();
      const childLogger = logger.child('grove:workspace');

      await create('feature-x', { from: testRepoId, logger });

      expect(childLogger.info).toHaveBeenCalled();
    });

    it('works without logger (backward compatible)', async () => {
      mockResolveRepoPath.mockResolvedValue('/repos/project');
      mockInternalCreate.mockResolvedValue({
        id: 'project-feature-x',
        root: '/home/user/worktrees/project/feature-x',
        branch: 'feature-x',
        repos: ['project'],
      });

      await expect(create('feature-x', { from: testRepoId })).resolves.toBeDefined();
    });
  });

  describe('sync with logger', () => {
    it('calls logger.info when workspace is synced', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalSync.mockResolvedValue({
        synced: ['project'],
        details: [{ name: 'project', status: 'synced' }],
      });

      const logger = makeMockLogger();
      const childLogger = logger.child('grove:workspace');

      await sync(testWsId, { logger });

      expect(childLogger.info).toHaveBeenCalled();
    });

    it('works without logger (backward compatible)', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalSync.mockResolvedValue({ synced: ['project'], details: [] });

      await expect(sync(testWsId)).resolves.toBeDefined();
    });
  });

  describe('close with logger', () => {
    it('calls logger.info when workspace is closed', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalClose.mockResolvedValue(undefined);

      const logger = makeMockLogger();
      const childLogger = logger.child('grove:workspace');

      await close(testWsId, 'merge', { logger });

      expect(childLogger.info).toHaveBeenCalled();
    });

    it('works without logger (backward compatible)', async () => {
      mockInternalReadState.mockResolvedValue(makeState());
      mockInternalClose.mockResolvedValue(undefined);

      await expect(close(testWsId, 'merge')).resolves.toBeDefined();
    });
  });
});
