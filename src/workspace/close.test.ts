import { describe, it, expect, vi, beforeEach } from 'vitest';
import { closeWorkspace } from './close.js';
import type { WorkspaceState } from './types.js';

const mockReadWorkspaceState = vi.hoisted(() => vi.fn());
const mockWriteWorkspaceState = vi.hoisted(() => vi.fn());
const mockFindWorkspaceByBranch = vi.hoisted(() => vi.fn());
const mockDeleteWorkspaceState = vi.hoisted(() => vi.fn());
const mockHasDirtyWorkingTree = vi.hoisted(() => vi.fn());
const mockCheckout = vi.hoisted(() => vi.fn());
const mockMergeFFOnly = vi.hoisted(() => vi.fn());
const mockMerge = vi.hoisted(() => vi.fn());
const mockRemoveWorktree = vi.hoisted(() => vi.fn());
const mockDeleteBranch = vi.hoisted(() => vi.fn());
const mockMergeAbort = vi.hoisted(() => vi.fn());
const mockGetRepoStatus = vi.hoisted(() => vi.fn());
const mockSyncWorkspace = vi.hoisted(() => vi.fn());
const mockConflictError = vi.hoisted(() => {
  class ConflictError extends Error {
    constructor(
      message: string,
      public readonly conflicted: string,
      public readonly files: string[],
      public readonly resolved: string[],
      public readonly pending: string[],
    ) {
      super(message);
      this.name = 'ConflictError';
    }
  }
  return ConflictError;
});

vi.mock('./state.js', () => ({
  readWorkspaceState: mockReadWorkspaceState,
  writeWorkspaceState: mockWriteWorkspaceState,
  findWorkspaceByBranch: mockFindWorkspaceByBranch,
  deleteWorkspaceState: mockDeleteWorkspaceState,
}));

vi.mock('./git.js', () => ({
  hasDirtyWorkingTree: mockHasDirtyWorkingTree,
  checkout: mockCheckout,
  mergeFFOnly: mockMergeFFOnly,
  merge: mockMerge,
  removeWorktree: mockRemoveWorktree,
  deleteBranch: mockDeleteBranch,
  mergeAbort: mockMergeAbort,
  getRepoStatus: mockGetRepoStatus,
}));

vi.mock('./sync.js', () => ({
  syncWorkspace: mockSyncWorkspace,
  ConflictError: mockConflictError,
}));

describe('closeWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: sync succeeds (close --merge always syncs before FF check)
    mockSyncWorkspace.mockResolvedValue({ synced: [], details: [] });
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

  describe('merge mode', () => {
    it('syncs then closes workspace successfully', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMergeFFOnly.mockReturnValue(true);

      await closeWorkspace('feature-x', 'merge');

      // Verify sync was called before anything else
      expect(mockSyncWorkspace).toHaveBeenCalledWith('feature-x', undefined);

      // Verify state was set to closing
      expect(mockWriteWorkspaceState).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'closing',
        })
      );

      // Verify close loop processes children before parent
      const checkoutCalls = mockCheckout.mock.calls;
      expect(checkoutCalls[0]).toEqual(['/tmp/repos/myproject/public', 'main']);
      expect(checkoutCalls[1]).toEqual(['/tmp/repos/myproject', 'main']);

      // Verify ff-merge for both repos
      expect(mockMergeFFOnly).toHaveBeenCalledWith(
        '/tmp/repos/myproject/public',
        'feature-x'
      );
      expect(mockMergeFFOnly).toHaveBeenCalledWith(
        '/tmp/repos/myproject',
        'feature-x'
      );

      // Verify worktrees removed
      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        '/tmp/repos/myproject/public',
        '/tmp/worktrees/myproject/feature-x/public'
      );
      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        '/tmp/repos/myproject',
        '/tmp/worktrees/myproject/feature-x'
      );

      // Verify branches deleted
      expect(mockDeleteBranch).toHaveBeenCalledWith(
        '/tmp/repos/myproject/public',
        'feature-x'
      );
      expect(mockDeleteBranch).toHaveBeenCalledWith(
        '/tmp/repos/myproject',
        'feature-x'
      );

      // Verify state deleted
      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
    });

    it('processes children before parent in close loop', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMergeFFOnly.mockReturnValue(true);

      await closeWorkspace('feature-x', 'merge');

      const checkoutCalls = mockCheckout.mock.calls;
      // Close loop: child first, parent last
      expect(checkoutCalls[0][0]).toBe('/tmp/repos/myproject/public'); // child first
      expect(checkoutCalls[1][0]).toBe('/tmp/repos/myproject'); // parent last
    });

    it('throws error when workspace has dirty files', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValueOnce(true);

      await expect(closeWorkspace('feature-x', 'merge')).rejects.toThrow(
        "Uncommitted changes in 'myproject'. Commit or stash before closing."
      );

      // Should fail before sync
      expect(mockSyncWorkspace).not.toHaveBeenCalled();
      expect(mockCheckout).not.toHaveBeenCalled();
      expect(mockMergeFFOnly).not.toHaveBeenCalled();
    });

    it('throws error when workspace is in creating state', async () => {
      const state = createWorkspaceState({ status: 'creating' as 'active' });
      mockReadWorkspaceState.mockResolvedValue(state);

      await expect(closeWorkspace('feature-x', 'merge')).rejects.toThrow(
        "Cannot merge-close workspace in 'creating' state. Use --discard instead."
      );
    });

    it('retries with targeted merge when ff-merge fails, succeeds on retry', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMerge.mockReturnValue({ ok: true, conflicts: [] });
      mockMergeFFOnly
        .mockReturnValueOnce(true)   // child succeeds
        .mockReturnValueOnce(false)  // parent fails first attempt (race condition)
        .mockReturnValueOnce(true);  // parent succeeds on retry

      await closeWorkspace('feature-x', 'merge');

      // Targeted merge on the failing repo's worktree (not full workspace sync)
      expect(mockMerge).toHaveBeenCalledWith('/tmp/worktrees/myproject/feature-x', 'main');
      expect(mockMerge).toHaveBeenCalledTimes(1);

      // Initial sync only — no re-sync during retry
      expect(mockSyncWorkspace).toHaveBeenCalledTimes(1);

      // Verify state was deleted (close completed)
      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
    });

    it('sets state to failed when ff-merge fails even after retry', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMerge.mockReturnValue({ ok: true, conflicts: [] });
      mockMergeFFOnly
        .mockReturnValueOnce(true)   // child succeeds
        .mockReturnValueOnce(false)  // parent fails first attempt
        .mockReturnValueOnce(false); // parent fails retry too

      await expect(closeWorkspace('feature-x', 'merge')).rejects.toThrow(
        "Fast-forward merge failed for 'myproject' during close. " +
        "Workspace is partially closed — run 'grove workspace close feature-x --discard' to clean up."
      );

      // Verify state was set to failed
      const failedWrite = mockWriteWorkspaceState.mock.calls.find(
        ([s]: [WorkspaceState]) => s.status === 'failed',
      );
      expect(failedWrite).toBeDefined();
    });

    it('sets state to failed when retry merge has conflicts', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMergeFFOnly
        .mockReturnValueOnce(true)   // child succeeds
        .mockReturnValueOnce(false); // parent fails first attempt
      mockMerge.mockReturnValue({ ok: false, conflicts: ['file.ts'] });

      await expect(closeWorkspace('feature-x', 'merge')).rejects.toThrow(
        "Merge conflicts in 'myproject' during close retry. " +
        "Workspace is partially closed — run 'grove workspace close feature-x --discard' to clean up."
      );

      // Targeted merge was attempted on the failing repo
      expect(mockMerge).toHaveBeenCalledWith('/tmp/worktrees/myproject/feature-x', 'main');

      // FF-merge should NOT have been retried (merge itself failed)
      expect(mockMergeFFOnly).toHaveBeenCalledTimes(2);

      // Verify state was set to failed
      const failedWrite = mockWriteWorkspaceState.mock.calls.find(
        ([s]: [WorkspaceState]) => s.status === 'failed',
      );
      expect(failedWrite).toBeDefined();
    });

    it('logs retry attempts when logger is provided', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMerge.mockReturnValue({ ok: true, conflicts: [] });
      mockMergeFFOnly
        .mockReturnValueOnce(true)   // child succeeds
        .mockReturnValueOnce(false)  // parent fails first attempt
        .mockReturnValueOnce(true);  // parent succeeds on retry

      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };

      await closeWorkspace('feature-x', 'merge', { logger });

      expect(logger.info).toHaveBeenCalledWith(
        'ff-merge failed, re-merging and retrying',
        { repo: 'myproject', branch: 'feature-x' },
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'repo merged',
        { repo: 'myproject', branch: 'feature-x' },
      );
    });

    it('throws error when workspace not found', async () => {
      mockReadWorkspaceState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(null);

      await expect(closeWorkspace('nonexistent', 'merge')).rejects.toThrow(
        "No workspace found for 'nonexistent'"
      );
    });

    it('continues cleanup even if worktree removal fails', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMergeFFOnly.mockReturnValue(true);
      mockRemoveWorktree.mockImplementation(() => {
        throw new Error('Worktree removal failed');
      });

      await closeWorkspace('feature-x', 'merge');

      // Verify branch deletion still happened
      expect(mockDeleteBranch).toHaveBeenCalledTimes(2);
      expect(mockDeleteWorkspaceState).toHaveBeenCalled();
    });

    it('continues cleanup even if branch deletion fails', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMergeFFOnly.mockReturnValue(true);
      mockDeleteBranch.mockImplementation(() => {
        throw new Error('Branch deletion failed');
      });

      await closeWorkspace('feature-x', 'merge');

      // Verify state still deleted
      expect(mockDeleteWorkspaceState).toHaveBeenCalled();
    });

    it('throws descriptive error when sync hits conflicts, stays active', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockSyncWorkspace.mockRejectedValue(
        new mockConflictError('Merge conflicts in public', 'public', ['file.ts'], ['myproject'], []),
      );

      await expect(closeWorkspace('feature-x', 'merge')).rejects.toThrow(
        "Cannot merge: conflicts in 'public'"
      );

      // Workspace should NOT have been set to 'closing' or 'failed'
      expect(mockWriteWorkspaceState).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'closing' })
      );
      expect(mockWriteWorkspaceState).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' })
      );
    });

    it('allows merge-close from failed state (recovery)', async () => {
      const state = createWorkspaceState({ status: 'failed' });
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockMergeFFOnly.mockReturnValue(true);

      await closeWorkspace('feature-x', 'merge');

      // Sync should re-sync the failed workspace
      expect(mockSyncWorkspace).toHaveBeenCalledWith('feature-x', undefined);

      // Verify close completed
      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
    });

    it('dry-run skips sync and merge', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockHasDirtyWorkingTree.mockReturnValue(false);
      mockGetRepoStatus.mockReturnValue({ dirty: 0, commits: 3 });

      const result = await closeWorkspace('feature-x', 'merge', { dryRun: true });

      // sync and merge should not have been called
      expect(mockSyncWorkspace).not.toHaveBeenCalled();
      expect(mockMergeFFOnly).not.toHaveBeenCalled();

      // Should return dry-run result
      expect(result).toEqual({
        repos: [
          { name: 'myproject', role: 'parent', commits: 3 },
          { name: 'public', role: 'child', commits: 3 },
        ],
      });
    });

    it('rejects closing state', async () => {
      const state = createWorkspaceState({ status: 'closing' });
      mockReadWorkspaceState.mockResolvedValue(state);

      await expect(closeWorkspace('feature-x', 'merge')).rejects.toThrow(
        "Cannot merge-close workspace in 'closing' state. Use --discard instead."
      );
    });
  });

  describe('discard mode', () => {
    it('discards workspace successfully', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);

      await closeWorkspace('feature-x', 'discard');

      // Verify state set to closing
      expect(mockWriteWorkspaceState).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'closing',
        })
      );

      // Verify merge abort called
      expect(mockMergeAbort).toHaveBeenCalledTimes(2);

      // Verify worktrees removed with force flag
      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        '/tmp/repos/myproject',
        '/tmp/worktrees/myproject/feature-x',
        true
      );
      expect(mockRemoveWorktree).toHaveBeenCalledWith(
        '/tmp/repos/myproject/public',
        '/tmp/worktrees/myproject/feature-x/public',
        true
      );

      // Verify branches deleted with force flag
      expect(mockDeleteBranch).toHaveBeenCalledWith(
        '/tmp/repos/myproject',
        'feature-x',
        true
      );
      expect(mockDeleteBranch).toHaveBeenCalledWith(
        '/tmp/repos/myproject/public',
        'feature-x',
        true
      );

      // Verify state deleted
      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
    });

    it('processes repos in reverse order', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);

      await closeWorkspace('feature-x', 'discard');

      const removeWorktreeCalls = mockRemoveWorktree.mock.calls;
      // reverse() means child (index 1) first, then parent (index 0)
      expect(removeWorktreeCalls[0][0]).toBe('/tmp/repos/myproject/public'); // child first
      expect(removeWorktreeCalls[1][0]).toBe('/tmp/repos/myproject'); // parent last
    });

    it('succeeds even when workspace is in failed state', async () => {
      const state = createWorkspaceState({ status: 'failed' });
      mockReadWorkspaceState.mockResolvedValue(state);

      await closeWorkspace('feature-x', 'discard');

      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
    });

    it('completes even when all operations fail', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockMergeAbort.mockImplementation(() => {
        throw new Error('Merge abort failed');
      });
      mockRemoveWorktree.mockImplementation(() => {
        throw new Error('Worktree removal failed');
      });
      mockDeleteBranch.mockImplementation(() => {
        throw new Error('Branch deletion failed');
      });

      // Should not throw
      await closeWorkspace('feature-x', 'discard');

      // Verify state was still deleted
      expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
    });

    it('continues even if state write fails', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(state);
      mockWriteWorkspaceState.mockImplementation(() => {
        throw new Error('State write failed');
      });

      // Should not throw
      await closeWorkspace('feature-x', 'discard');

      // Verify cleanup still happened
      expect(mockMergeAbort).toHaveBeenCalled();
      expect(mockRemoveWorktree).toHaveBeenCalled();
      expect(mockDeleteBranch).toHaveBeenCalled();
      expect(mockDeleteWorkspaceState).toHaveBeenCalled();
    });

    it('finds workspace by branch when not found by ID', async () => {
      const state = createWorkspaceState();
      mockReadWorkspaceState.mockResolvedValue(null);
      mockFindWorkspaceByBranch.mockResolvedValue(state);

      await closeWorkspace('feature-x', 'discard');

      expect(mockFindWorkspaceByBranch).toHaveBeenCalledWith('feature-x');
      expect(mockDeleteWorkspaceState).toHaveBeenCalled();
    });
  });
});
