import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listWorkspaces, getWorkspaceStatus } from './status.js';
import type { WorkspaceState } from './types.js';

const mockListWorkspaceStates = vi.hoisted(() => vi.fn());
const mockReadWorkspaceState = vi.hoisted(() => vi.fn());
const mockFindWorkspaceByBranch = vi.hoisted(() => vi.fn());
const mockGetRepoStatus = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('./state.js', () => ({
  listWorkspaceStates: mockListWorkspaceStates,
  readWorkspaceState: mockReadWorkspaceState,
  findWorkspaceByBranch: mockFindWorkspaceByBranch,
}));

vi.mock('./git.js', () => ({
  getRepoStatus: mockGetRepoStatus,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

describe('listWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWorkspaceState = (overrides?: Partial<WorkspaceState>): WorkspaceState => ({
    version: 1,
    id: 'myproject-feature-x',
    status: 'active',
    branch: 'feature-x',
    createdAt: '2026-02-13T10:00:00Z',
    updatedAt: '2026-02-13T14:00:00Z',
    root: '/tmp/worktrees/myproject/feature-x',
    source: '/tmp/repos/myproject',
    repos: [
      {
        name: 'myproject',
        role: 'parent',
        source: '/tmp/repos/myproject',
        worktree: '/tmp/worktrees/myproject/feature-x',
        parentBranch: 'main',
      },
      {
        name: 'public',
        role: 'child',
        source: '/tmp/repos/myproject/public',
        worktree: '/tmp/worktrees/myproject/feature-x/public',
        parentBranch: 'main',
      },
    ],
    sync: null,
    ...overrides,
  });

  it('maps workspace states to list items', () => {
    const state1 = createWorkspaceState();
    const state2 = createWorkspaceState({
      id: 'myproject-feature-y',
      branch: 'feature-y',
      status: 'closing',
      root: '/tmp/worktrees/myproject/feature-y',
      createdAt: '2026-02-14T10:00:00Z',
    });
    mockListWorkspaceStates.mockReturnValue([state1, state2]);
    mockExistsSync.mockReturnValue(true);

    const result = listWorkspaces();

    expect(result).toEqual([
      {
        id: 'myproject-feature-x',
        branch: 'feature-x',
        status: 'active',
        root: '/tmp/worktrees/myproject/feature-x',
        repos: ['myproject', 'public'],
        createdAt: '2026-02-13T10:00:00Z',
        age: expect.any(String),
        missing: false,
      },
      {
        id: 'myproject-feature-y',
        branch: 'feature-y',
        status: 'closing',
        root: '/tmp/worktrees/myproject/feature-y',
        repos: ['myproject', 'public'],
        createdAt: '2026-02-14T10:00:00Z',
        age: expect.any(String),
        missing: false,
      },
    ]);
  });

  it('returns empty array when no workspaces exist', () => {
    mockListWorkspaceStates.mockReturnValue([]);

    const result = listWorkspaces();

    expect(result).toEqual([]);
  });

  it('flags workspaces whose root directory is missing', () => {
    const state = createWorkspaceState();
    mockListWorkspaceStates.mockReturnValue([state]);
    mockExistsSync.mockReturnValue(false);

    const result = listWorkspaces();

    expect(result).toHaveLength(1);
    expect(result[0].missing).toBe(true);
  });
});

describe('getWorkspaceStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWorkspaceState = (overrides?: Partial<WorkspaceState>): WorkspaceState => ({
    version: 1,
    id: 'myproject-feature-x',
    status: 'active',
    branch: 'feature-x',
    createdAt: '2026-02-13T10:00:00Z',
    updatedAt: '2026-02-13T14:00:00Z',
    root: '/tmp/worktrees/myproject/feature-x',
    source: '/tmp/repos/myproject',
    repos: [
      {
        name: 'myproject',
        role: 'parent',
        source: '/tmp/repos/myproject',
        worktree: '/tmp/worktrees/myproject/feature-x',
        parentBranch: 'main',
      },
      {
        name: 'public',
        role: 'child',
        source: '/tmp/repos/myproject/public',
        worktree: '/tmp/worktrees/myproject/feature-x/public',
        parentBranch: 'main',
      },
    ],
    sync: null,
    ...overrides,
  });

  it('returns status with repo details by branch', () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValueOnce({ dirty: 2, commits: 3 });
    mockGetRepoStatus.mockReturnValueOnce({ dirty: 0, commits: 1 });

    const result = getWorkspaceStatus('feature-x');

    expect(result).toEqual({
      id: 'myproject-feature-x',
      status: 'active',
      branch: 'feature-x',
      repos: [
        {
          name: 'myproject',
          role: 'parent',
          dirty: 2,
          commits: 3,
          syncStatus: null,
        },
        {
          name: 'public',
          role: 'child',
          dirty: 0,
          commits: 1,
          syncStatus: null,
        },
      ],
    });

    expect(mockGetRepoStatus).toHaveBeenCalledWith(
      '/tmp/worktrees/myproject/feature-x',
      'main'
    );
    expect(mockGetRepoStatus).toHaveBeenCalledWith(
      '/tmp/worktrees/myproject/feature-x/public',
      'main'
    );
  });

  it('returns status by workspace ID', () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    const result = getWorkspaceStatus('myproject-feature-x');

    expect(result.id).toBe('myproject-feature-x');
    expect(mockReadWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
  });

  it('auto-detects workspace from current working directory', () => {
    const state = createWorkspaceState();
    mockListWorkspaceStates.mockReturnValue([state]);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    // Mock process.cwd to be inside the workspace
    const originalCwd = process.cwd;
    process.cwd = vi.fn(() => '/tmp/worktrees/myproject/feature-x/subdir');

    const result = getWorkspaceStatus();

    expect(result.id).toBe('myproject-feature-x');

    // Restore original cwd
    process.cwd = originalCwd;
  });

  it('throws error when workspace not found by branch', () => {
    mockReadWorkspaceState.mockReturnValue(null);
    mockFindWorkspaceByBranch.mockReturnValue(null);

    expect(() => getWorkspaceStatus('nonexistent')).toThrow(
      "No workspace found for 'nonexistent'"
    );
  });

  it('throws error when auto-detect fails', () => {
    mockListWorkspaceStates.mockReturnValue([]);
    const originalCwd = process.cwd;
    process.cwd = vi.fn(() => '/some/other/path');

    expect(() => getWorkspaceStatus()).toThrow(
      'Not inside a workspace. Specify a branch name or run from a workspace directory.'
    );

    process.cwd = originalCwd;
  });

  it('includes sync status per repo', () => {
    const state = createWorkspaceState({
      sync: {
        startedAt: '2026-02-13T14:00:00Z',
        repos: {
          myproject: 'synced',
          public: 'conflicted',
        },
      },
    });
    mockReadWorkspaceState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    const result = getWorkspaceStatus('feature-x');

    expect(result.repos[0].syncStatus).toBe('synced');
    expect(result.repos[1].syncStatus).toBe('conflicted');
  });

  it('returns zero dirty/commits when worktree does not exist', () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(false);

    const result = getWorkspaceStatus('feature-x');

    expect(result.repos[0].dirty).toBe(0);
    expect(result.repos[0].commits).toBe(0);
    expect(result.repos[1].dirty).toBe(0);
    expect(result.repos[1].commits).toBe(0);
    expect(mockGetRepoStatus).not.toHaveBeenCalled();
  });

  it('finds workspace by branch when not found by ID', () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockReturnValue(null);
    mockFindWorkspaceByBranch.mockReturnValue(state);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    const result = getWorkspaceStatus('feature-x');

    expect(mockFindWorkspaceByBranch).toHaveBeenCalledWith('feature-x');
    expect(result.id).toBe('myproject-feature-x');
  });

  it('handles mixed worktree existence', () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockReturnValue(state);
    mockExistsSync.mockReturnValueOnce(true); // parent exists
    mockExistsSync.mockReturnValueOnce(false); // child doesn't exist
    mockGetRepoStatus.mockReturnValue({ dirty: 2, commits: 3 });

    const result = getWorkspaceStatus('feature-x');

    expect(result.repos[0].dirty).toBe(2); // parent has status
    expect(result.repos[0].commits).toBe(3);
    expect(result.repos[1].dirty).toBe(0); // child has zeros
    expect(result.repos[1].commits).toBe(0);
    expect(mockGetRepoStatus).toHaveBeenCalledTimes(1);
  });

  it('detects workspace when cwd is in nested directory', () => {
    const state = createWorkspaceState();
    mockListWorkspaceStates.mockReturnValue([state]);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    const originalCwd = process.cwd;
    process.cwd = vi.fn(() => '/tmp/worktrees/myproject/feature-x/public/deep/nested/path');

    const result = getWorkspaceStatus();

    expect(result.id).toBe('myproject-feature-x');

    process.cwd = originalCwd;
  });

  it('does not false-match cwd with similar prefix to workspace root', () => {
    const state = createWorkspaceState({
      root: '/tmp/worktrees/myproject/feature-x',
    });
    mockListWorkspaceStates.mockReturnValue([state]);

    const originalCwd = process.cwd;
    // cwd has the workspace root as a prefix but is NOT inside it
    process.cwd = vi.fn(() => '/tmp/worktrees/myproject/feature-x-other/subdir');

    expect(() => getWorkspaceStatus()).toThrow(
      'Not inside a workspace. Specify a branch name or run from a workspace directory.',
    );

    process.cwd = originalCwd;
  });

  it('matches when cwd is exactly the workspace root', () => {
    const state = createWorkspaceState({
      root: '/tmp/worktrees/myproject/feature-x',
    });
    mockListWorkspaceStates.mockReturnValue([state]);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    const originalCwd = process.cwd;
    process.cwd = vi.fn(() => '/tmp/worktrees/myproject/feature-x');

    const result = getWorkspaceStatus();
    expect(result.id).toBe('myproject-feature-x');

    process.cwd = originalCwd;
  });

  it('returns correct status for workspace in closing state', () => {
    const state = createWorkspaceState({ status: 'closing' });
    mockReadWorkspaceState.mockReturnValue(state);
    mockExistsSync.mockReturnValue(true);
    mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 0 });

    const result = getWorkspaceStatus('feature-x');

    expect(result.status).toBe('closing');
  });
});
