import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspace } from './create.js';
import type { WorkspaceState } from './types.js';

// Mock dependencies using vi.hoisted
const {
  mockExecSync,
  mockLoadWorkspaceConfig,
  mockPreflightCreate,
  mockValidateRepoPaths,
  mockCreateWorktree,
  mockRemoveWorktree,
  mockDeleteBranch,
  mockGetWorktreeBasePath,
  mockWriteWorkspaceState,
  mockReadWorkspaceState,
  mockDeleteWorkspaceState,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockLoadWorkspaceConfig: vi.fn(),
  mockPreflightCreate: vi.fn(),
  mockValidateRepoPaths: vi.fn(() => []),
  mockCreateWorktree: vi.fn(),
  mockRemoveWorktree: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockGetWorktreeBasePath: vi.fn(),
  mockWriteWorkspaceState: vi.fn(),
  mockReadWorkspaceState: vi.fn(),
  mockDeleteWorkspaceState: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../config.js', () => ({
  loadWorkspaceConfig: mockLoadWorkspaceConfig,
}));

vi.mock('./preflight.js', () => ({
  preflightCreate: mockPreflightCreate,
  validateRepoPaths: mockValidateRepoPaths,
}));

vi.mock('./git.js', () => ({
  createWorktree: mockCreateWorktree,
  removeWorktree: mockRemoveWorktree,
  deleteBranch: mockDeleteBranch,
  getWorktreeBasePath: mockGetWorktreeBasePath,
}));

vi.mock('./state.js', () => ({
  writeWorkspaceState: mockWriteWorkspaceState,
  readWorkspaceState: mockReadWorkspaceState,
  deleteWorkspaceState: mockDeleteWorkspaceState,
}));

describe('createWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('/repos/project');
    mockReadWorkspaceState.mockReturnValue(null);
    mockLoadWorkspaceConfig.mockReturnValue(null);
    mockGetWorktreeBasePath.mockReturnValue('/home/user/worktrees');
    // Make writeWorkspaceState clone the argument to capture state at call time
    mockWriteWorkspaceState.mockImplementation((state) => {
      mockWriteWorkspaceState.mock.calls[mockWriteWorkspaceState.mock.calls.length - 1][0] =
        JSON.parse(JSON.stringify(state));
      return Promise.resolve();
    });
  });

  it('simple workspace create (no config) → calls createWorktree once, writes state twice (creating then active)', async () => {
    mockPreflightCreate.mockReturnValue({
      ok: true,
      sources: [
        {
          name: 'project',
          role: 'parent',
          source: '/repos/project',
          parentBranch: 'main',
        },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    const result = await createWorkspace('feature-x');

    expect(result).toEqual({
      id: 'project-feature-x',
      root: '/home/user/worktrees/project/feature-x',
      repos: ['project'],
      branch: 'feature-x',
    });

    expect(mockCreateWorktree).toHaveBeenCalledTimes(1);
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      '/repos/project',
      'feature-x',
      '/home/user/worktrees/project/feature-x'
    );

    expect(mockWriteWorkspaceState).toHaveBeenCalledTimes(2);

    // First call: status 'creating'
    const firstCall = mockWriteWorkspaceState.mock.calls[0][0] as WorkspaceState;
    expect(firstCall.status).toBe('creating');
    expect(firstCall.id).toBe('project-feature-x');
    expect(firstCall.branch).toBe('feature-x');
    expect(firstCall.root).toBe('/home/user/worktrees/project/feature-x');
    expect(firstCall.repos).toHaveLength(1);

    // Second call: status 'active'
    const secondCall = mockWriteWorkspaceState.mock.calls[1][0] as WorkspaceState;
    expect(secondCall.status).toBe('active');
    expect(secondCall.id).toBe('project-feature-x');
  });

  it('grouped workspace create (with config) → calls createWorktree for parent and children', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [
        { path: 'public' },
        { path: 'cloud' },
      ],
    });

    mockPreflightCreate.mockReturnValue({
      ok: true,
      sources: [
        {
          name: 'project',
          role: 'parent',
          source: '/repos/project',
          parentBranch: 'main',
        },
        {
          name: 'public',
          role: 'child',
          source: '/repos/project/public',
          parentBranch: 'main',
        },
        {
          name: 'cloud',
          role: 'child',
          source: '/repos/project/cloud',
          parentBranch: 'main',
        },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    const result = await createWorkspace('feature-x');

    expect(result.repos).toEqual(['project', 'public', 'cloud']);

    expect(mockCreateWorktree).toHaveBeenCalledTimes(3);
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      '/repos/project',
      'feature-x',
      '/home/user/worktrees/project/feature-x'
    );
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      '/repos/project/public',
      'feature-x',
      '/home/user/worktrees/project/feature-x/public'
    );
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      '/repos/project/cloud',
      'feature-x',
      '/home/user/worktrees/project/feature-x/cloud'
    );
  });

  it('invalid repo paths → throws before preflight', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [
        { path: '../escape' },
        { path: '/absolute/path' },
      ],
    });
    mockValidateRepoPaths.mockReturnValue([
      "Workspace repo path must not contain '..': '../escape'",
      "Workspace repo path must be relative: '/absolute/path'",
    ]);

    await expect(createWorkspace('feature-x')).rejects.toThrow("must not contain '..'");

    expect(mockPreflightCreate).not.toHaveBeenCalled();
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });

  it('preflight failure → throws error, no worktrees created', async () => {
    mockPreflightCreate.mockReturnValue({
      ok: false,
      errors: ['Branch already exists', 'Workspace already exists'],
    });

    await expect(createWorkspace('feature-x')).rejects.toThrow(
      'Branch already exists\nWorkspace already exists'
    );

    expect(mockCreateWorktree).not.toHaveBeenCalled();
    expect(mockWriteWorkspaceState).not.toHaveBeenCalled();
  });

  it('rollback on createWorktree failure → removes already-created worktrees, state set to failed', async () => {
    mockPreflightCreate.mockReturnValue({
      ok: true,
      sources: [
        {
          name: 'project',
          role: 'parent',
          source: '/repos/project',
          parentBranch: 'main',
        },
        {
          name: 'lib',
          role: 'child',
          source: '/repos/lib',
          parentBranch: 'main',
        },
        {
          name: 'utils',
          role: 'child',
          source: '/repos/utils',
          parentBranch: 'main',
        },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    // First worktree succeeds, second succeeds, third fails
    mockCreateWorktree
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('Failed to create worktree for utils');
      });

    await expect(createWorkspace('feature-x')).rejects.toThrow('Failed to create worktree for utils');

    // Should have attempted to create all three
    expect(mockCreateWorktree).toHaveBeenCalledTimes(3);

    // Should rollback in reverse order (utils first, then lib, then project)
    expect(mockRemoveWorktree).toHaveBeenCalledTimes(2);
    expect(mockRemoveWorktree).toHaveBeenNthCalledWith(
      1,
      '/repos/lib',
      '/home/user/worktrees/project/feature-x/lib',
      true
    );
    expect(mockRemoveWorktree).toHaveBeenNthCalledWith(
      2,
      '/repos/project',
      '/home/user/worktrees/project/feature-x',
      true
    );

    expect(mockDeleteBranch).toHaveBeenCalledTimes(2);
    expect(mockDeleteBranch).toHaveBeenNthCalledWith(1, '/repos/lib', 'feature-x', true);
    expect(mockDeleteBranch).toHaveBeenNthCalledWith(2, '/repos/project', 'feature-x', true);

    // Final state write should be 'failed'
    const lastCall = mockWriteWorkspaceState.mock.calls[mockWriteWorkspaceState.mock.calls.length - 1][0] as WorkspaceState;
    expect(lastCall.status).toBe('failed');
  });

  it('existing failed state → cleaned up before retrying', async () => {
    mockReadWorkspaceState.mockReturnValue({
      version: 1,
      id: 'project-feature-x',
      status: 'failed',
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
        {
          name: 'lib',
          role: 'child',
          source: '/repos/lib',
          worktree: '/home/user/worktrees/project/feature-x/lib',
          parentBranch: 'main',
        },
      ],
      sync: null,
    });

    mockPreflightCreate.mockReturnValue({
      ok: true,
      sources: [
        {
          name: 'project',
          role: 'parent',
          source: '/repos/project',
          parentBranch: 'main',
        },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    await createWorkspace('feature-x');

    // Should cleanup failed state first (in reverse order)
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      '/repos/lib',
      '/home/user/worktrees/project/feature-x/lib',
      true
    );
    expect(mockRemoveWorktree).toHaveBeenCalledWith(
      '/repos/project',
      '/home/user/worktrees/project/feature-x',
      true
    );
    expect(mockDeleteBranch).toHaveBeenCalledWith('/repos/lib', 'feature-x', true);
    expect(mockDeleteBranch).toHaveBeenCalledWith('/repos/project', 'feature-x', true);
    expect(mockDeleteWorkspaceState).toHaveBeenCalledWith('project-feature-x');

    // Then create new workspace
    expect(mockCreateWorktree).toHaveBeenCalled();
  });

  it('uses custom from path when provided', async () => {
    mockExecSync.mockReturnValue('/other/project');

    mockPreflightCreate.mockReturnValue({
      ok: true,
      sources: [
        {
          name: 'project',
          role: 'parent',
          source: '/other/project',
          parentBranch: 'main',
        },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    await createWorkspace('feature-x', { from: '/other/project/subdir' });

    expect(mockExecSync).toHaveBeenCalledWith(
      'git rev-parse --show-toplevel',
      expect.objectContaining({ cwd: '/other/project/subdir' })
    );
  });
});
