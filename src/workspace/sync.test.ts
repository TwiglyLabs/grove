import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncWorkspace, ConflictError } from './sync.js';
import type { WorkspaceState } from './types.js';

const mockReadWorkspaceState = vi.hoisted(() => vi.fn());
const mockWriteWorkspaceState = vi.hoisted(() => vi.fn());
const mockFindWorkspaceByBranch = vi.hoisted(() => vi.fn());
const mockMerge = vi.hoisted(() => vi.fn());
const mockIsMergeInProgress = vi.hoisted(() => vi.fn());
const mockHasDirtyWorkingTree = vi.hoisted(() => vi.fn());

vi.mock('./state.js', () => ({
  readWorkspaceState: mockReadWorkspaceState,
  writeWorkspaceState: mockWriteWorkspaceState,
  findWorkspaceByBranch: mockFindWorkspaceByBranch,
}));

vi.mock('./git.js', () => ({
  merge: mockMerge,
  isMergeInProgress: mockIsMergeInProgress,
  hasDirtyWorkingTree: mockHasDirtyWorkingTree,
}));

describe('syncWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make writeWorkspaceState clone the argument to capture state at call time
    mockWriteWorkspaceState.mockImplementation((state) => {
      mockWriteWorkspaceState.mock.calls[mockWriteWorkspaceState.mock.calls.length - 1][0] =
        JSON.parse(JSON.stringify(state));
      return Promise.resolve();
    });
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

  it('syncs all repos successfully with no conflicts', async () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockResolvedValue(state);
    mockMerge.mockReturnValue({ ok: true, conflicts: [] });

    const result = await syncWorkspace('feature-x');

    expect(result.synced).toEqual(['myproject', 'public']);
    expect(mockMerge).toHaveBeenCalledWith('/tmp/worktrees/myproject/feature-x', 'main');
    expect(mockMerge).toHaveBeenCalledWith('/tmp/worktrees/myproject/feature-x/public', 'main');

    // Verify sync state was initialized, updated for each repo, and cleared
    // Expected: 1 init + 2 repo updates + 1 clear = 4 calls
    expect(mockWriteWorkspaceState).toHaveBeenCalledTimes(4);
    const finalCall = mockWriteWorkspaceState.mock.calls[3][0];
    expect(finalCall.sync).toBeNull();
  });

  it('syncs parent repo first before children', async () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockResolvedValue(state);
    mockMerge.mockReturnValue({ ok: true, conflicts: [] });

    await syncWorkspace('feature-x');

    // Parent should be synced before child
    const firstMerge = mockMerge.mock.calls[0][0];
    const secondMerge = mockMerge.mock.calls[1][0];
    expect(firstMerge).toBe('/tmp/worktrees/myproject/feature-x'); // parent
    expect(secondMerge).toBe('/tmp/worktrees/myproject/feature-x/public'); // child
  });

  it('throws ConflictError when merge has conflicts', async () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockResolvedValue(state);
    mockMerge.mockReturnValueOnce({ ok: true, conflicts: [] }); // parent succeeds
    mockMerge.mockReturnValueOnce({ ok: false, conflicts: ['file1.ts', 'file2.ts'] }); // child fails

    await expect(syncWorkspace('feature-x')).rejects.toThrow(ConflictError);

    try {
      await syncWorkspace('feature-x');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const conflictError = error as ConflictError;
      expect(conflictError.conflicted).toBe('public');
      expect(conflictError.files).toEqual(['file1.ts', 'file2.ts']);
      expect(conflictError.resolved).toEqual(['myproject']);
      expect(conflictError.pending).toEqual([]);
    }
  });

  it('resumes after conflict resolution when worktree is clean', async () => {
    const state = createWorkspaceState({
      sync: {
        startedAt: '2026-02-13T14:00:00Z',
        repos: {
          myproject: 'synced',
          public: 'conflicted',
        },
      },
    });
    mockReadWorkspaceState.mockResolvedValue(state);
    mockIsMergeInProgress.mockReturnValue(false);
    mockHasDirtyWorkingTree.mockReturnValue(false);

    const result = await syncWorkspace('feature-x');

    expect(result.synced).toEqual(['myproject', 'public']);
    expect(mockMerge).not.toHaveBeenCalled(); // No new merges needed

    // Verify sync state was cleared
    const finalCall = mockWriteWorkspaceState.mock.calls[1][0];
    expect(finalCall.sync).toBeNull();
  });

  it('throws ConflictError when resuming with merge still in progress', async () => {
    const state = createWorkspaceState({
      sync: {
        startedAt: '2026-02-13T14:00:00Z',
        repos: {
          myproject: 'synced',
          public: 'conflicted',
        },
      },
    });
    mockReadWorkspaceState.mockResolvedValue(state);
    mockIsMergeInProgress.mockReturnValue(true);

    await expect(syncWorkspace('feature-x')).rejects.toThrow(ConflictError);

    try {
      await syncWorkspace('feature-x');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const conflictError = error as ConflictError;
      expect(conflictError.message).toContain('Merge still in progress');
      expect(conflictError.conflicted).toBe('public');
    }
  });

  it('throws ConflictError when resuming with dirty worktree but no merge in progress', async () => {
    const state = createWorkspaceState({
      sync: {
        startedAt: '2026-02-13T14:00:00Z',
        repos: {
          myproject: 'synced',
          public: 'conflicted',
        },
      },
    });
    mockReadWorkspaceState.mockResolvedValue(state);
    mockIsMergeInProgress.mockReturnValue(false);
    mockHasDirtyWorkingTree.mockReturnValue(true);

    await expect(syncWorkspace('feature-x')).rejects.toThrow(ConflictError);

    try {
      await syncWorkspace('feature-x');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const conflictError = error as ConflictError;
      expect(conflictError.message).toContain('Uncommitted changes');
      expect(conflictError.conflicted).toBe('public');
      expect(conflictError.resolved).toEqual(['myproject']);
    }
  });

  it('throws error when workspace not found', async () => {
    mockReadWorkspaceState.mockResolvedValue(null);
    mockFindWorkspaceByBranch.mockResolvedValue(null);

    await expect(syncWorkspace('nonexistent')).rejects.toThrow(
      "No workspace found for 'nonexistent'"
    );
  });

  it('throws error when workspace is in closing state', async () => {
    const state = createWorkspaceState({ status: 'closing' });
    mockReadWorkspaceState.mockResolvedValue(state);

    await expect(syncWorkspace('feature-x')).rejects.toThrow(
      "Workspace 'myproject-feature-x' is in 'closing' state, expected 'active' or 'failed'"
    );
  });

  it('throws error when workspace is in creating state', async () => {
    const state = createWorkspaceState({ status: 'creating' });
    mockReadWorkspaceState.mockResolvedValue(state);

    await expect(syncWorkspace('feature-x')).rejects.toThrow(
      "Workspace 'myproject-feature-x' is in 'creating' state, expected 'active' or 'failed'"
    );
  });

  it('syncs failed workspace after resetting to active', async () => {
    const state = createWorkspaceState({ status: 'failed' });
    mockReadWorkspaceState.mockResolvedValue(state);
    mockMerge.mockReturnValue({ ok: true, conflicts: [] });

    const result = await syncWorkspace('feature-x');

    expect(result.synced).toEqual(['myproject', 'public']);

    // First write should reset status to active
    const firstCall = mockWriteWorkspaceState.mock.calls[0][0];
    expect(firstCall.status).toBe('active');
  });

  it('finds workspace by branch when not found by ID', async () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockResolvedValue(null);
    mockFindWorkspaceByBranch.mockResolvedValue(state);
    mockMerge.mockReturnValue({ ok: true, conflicts: [] });

    const result = await syncWorkspace('feature-x');

    expect(mockFindWorkspaceByBranch).toHaveBeenCalledWith('feature-x');
    expect(result.synced).toEqual(['myproject', 'public']);
  });

  it('initializes sync state on first run', async () => {
    const state = createWorkspaceState();
    mockReadWorkspaceState.mockResolvedValue(state);
    mockMerge.mockReturnValue({ ok: true, conflicts: [] });

    await syncWorkspace('feature-x');

    // First write should initialize sync state
    const firstCall = mockWriteWorkspaceState.mock.calls[0][0];
    expect(firstCall.sync).toBeDefined();
    expect(firstCall.sync.repos).toEqual({
      myproject: 'pending',
      public: 'pending',
    });
    expect(firstCall.sync.startedAt).toBeDefined();
  });

  it('skips already synced repos', async () => {
    const state = createWorkspaceState({
      sync: {
        startedAt: '2026-02-13T14:00:00Z',
        repos: {
          myproject: 'synced',
          public: 'pending',
        },
      },
    });
    mockReadWorkspaceState.mockResolvedValue(state);
    mockMerge.mockReturnValue({ ok: true, conflicts: [] });

    const result = await syncWorkspace('feature-x');

    expect(result.synced).toEqual(['myproject', 'public']);
    // Only one merge for the pending repo
    expect(mockMerge).toHaveBeenCalledTimes(1);
  });
});
