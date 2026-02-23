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
  mockRunSetupCommands,
  mockRunHook,
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
  mockRunSetupCommands: vi.fn(),
  mockRunHook: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('./config.js', () => ({
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

vi.mock('./setup.js', () => ({
  runSetupCommands: mockRunSetupCommands,
  runHook: mockRunHook,
}));

describe('createWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('/repos/project');
    mockReadWorkspaceState.mockResolvedValue(null);
    mockDeleteWorkspaceState.mockResolvedValue(undefined);
    mockLoadWorkspaceConfig.mockReturnValue(null);
    mockValidateRepoPaths.mockReturnValue([]);
    mockGetWorktreeBasePath.mockReturnValue('/home/user/worktrees');
    // Make writeWorkspaceState clone the argument to capture state at call time
    mockWriteWorkspaceState.mockImplementation((state) => {
      mockWriteWorkspaceState.mock.calls[mockWriteWorkspaceState.mock.calls.length - 1][0] =
        JSON.parse(JSON.stringify(state));
      return Promise.resolve();
    });
  });

  it('simple workspace create (no config) → calls createWorktree once, writes state twice (creating then active)', async () => {
    mockPreflightCreate.mockResolvedValue({
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

    mockPreflightCreate.mockResolvedValue({
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
    mockPreflightCreate.mockResolvedValue({
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
    mockPreflightCreate.mockResolvedValue({
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
    mockReadWorkspaceState.mockResolvedValue({
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

    mockPreflightCreate.mockResolvedValue({
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

    mockPreflightCreate.mockResolvedValue({
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

  it('runs setup commands after worktree creation', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [{ path: 'public' }],
      setup: ['npm install', 'npm run codegen'],
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
        { name: 'public', role: 'child', source: '/repos/project/public', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunSetupCommands.mockReturnValue([
      { command: 'npm install', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100 },
      { command: 'npm run codegen', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 50 },
    ]);

    const result = await createWorkspace('feature-x');

    // Setup runs for each repo worktree
    expect(mockRunSetupCommands).toHaveBeenCalledTimes(2);
    expect(mockRunSetupCommands).toHaveBeenCalledWith(
      ['npm install', 'npm run codegen'],
      '/home/user/worktrees/project/feature-x',
    );
    expect(mockRunSetupCommands).toHaveBeenCalledWith(
      ['npm install', 'npm run codegen'],
      '/home/user/worktrees/project/feature-x/public',
    );

    expect(result.setup).toHaveLength(4); // 2 commands × 2 repos
  });

  it('marks workspace as failed when setup command fails', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [],
      setup: ['npm install', 'npm run codegen'],
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunSetupCommands.mockReturnValue([
      { command: 'npm install', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100 },
      { command: 'npm run codegen', exitCode: 1, stdout: '', stderr: 'codegen failed', durationMs: 50 },
    ]);

    const result = await createWorkspace('feature-x');

    // Should still return a result (not throw) with the setup results
    expect(result.setup).toHaveLength(2);
    expect(result.setup![1].exitCode).toBe(1);

    // Final state should be 'failed'
    const lastStateWrite = mockWriteWorkspaceState.mock.calls[mockWriteWorkspaceState.mock.calls.length - 1][0] as WorkspaceState;
    expect(lastStateWrite.status).toBe('failed');
  });

  it('runs postCreate hook after successful setup', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [],
      setup: ['npm install'],
      hooks: { postCreate: './scripts/post-create.sh' },
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunSetupCommands.mockReturnValue([
      { command: 'npm install', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100 },
    ]);

    mockRunHook.mockReturnValue({
      command: './scripts/post-create.sh',
      exitCode: 0,
      stdout: 'hook done',
      stderr: '',
      durationMs: 200,
    });

    const result = await createWorkspace('feature-x');

    expect(mockRunHook).toHaveBeenCalledWith(
      './scripts/post-create.sh',
      '/home/user/worktrees/project/feature-x',
    );
    expect(result.hookResult).toMatchObject({
      command: './scripts/post-create.sh',
      exitCode: 0,
    });
  });

  it('skips postCreate hook when setup fails', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [],
      setup: ['npm install'],
      hooks: { postCreate: './scripts/post-create.sh' },
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunSetupCommands.mockReturnValue([
      { command: 'npm install', exitCode: 1, stdout: '', stderr: 'fail', durationMs: 100 },
    ]);

    const result = await createWorkspace('feature-x');

    // Hook should not be called when setup failed
    expect(mockRunHook).not.toHaveBeenCalled();
    expect(result.hookResult).toBeUndefined();
  });

  it('does not run setup when no setup commands configured', async () => {
    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    const result = await createWorkspace('feature-x');

    expect(mockRunSetupCommands).not.toHaveBeenCalled();
    expect(result.setup).toBeUndefined();
  });

  it('marks workspace as failed when postCreate hook fails', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [],
      hooks: { postCreate: './scripts/post-create.sh' },
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunHook.mockReturnValue({
      command: './scripts/post-create.sh',
      exitCode: 1,
      stdout: '',
      stderr: 'hook failed',
      durationMs: 50,
    });

    await createWorkspace('feature-x');

    const lastStateWrite = mockWriteWorkspaceState.mock.calls[mockWriteWorkspaceState.mock.calls.length - 1][0] as WorkspaceState;
    expect(lastStateWrite.status).toBe('failed');
  });

  it('childRepos provided → uses those instead of config repos', async () => {
    // Config has repos, but childRepos should override
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [{ path: 'config-repo' }],
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
        { name: 'api', role: 'child', source: '/repos/api', parentBranch: 'main' },
        { name: 'web', role: 'child', source: '/repos/web', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    const result = await createWorkspace('feature-x', {
      from: '/repos/project',
      childRepos: [
        { path: '/repos/api', name: 'api' },
        { path: '/repos/web', name: 'web' },
      ],
    });

    expect(result.repos).toEqual(['project', 'api', 'web']);

    // Config repo path validation should NOT be called — childRepos bypass it
    expect(mockValidateRepoPaths).not.toHaveBeenCalled();

    // Preflight should receive sources built from childRepos
    const preflightSources = mockPreflightCreate.mock.calls[0][0];
    expect(preflightSources).toEqual([
      { path: '/repos/project', role: 'parent' },
      { path: '/repos/api', role: 'child', name: 'api' },
      { path: '/repos/web', role: 'child', name: 'web' },
    ]);
  });

  it('childRepos empty array → single-repo workspace', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [{ path: 'config-repo' }],
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    const result = await createWorkspace('feature-x', {
      from: '/repos/project',
      childRepos: [],
    });

    expect(result.repos).toEqual(['project']);

    // Preflight should only get parent
    const preflightSources = mockPreflightCreate.mock.calls[0][0];
    expect(preflightSources).toEqual([
      { path: '/repos/project', role: 'parent' },
    ]);
  });

  it('childRepos provided + config exists → childRepos wins, setup from config still runs', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [{ path: 'config-repo' }],
      setup: ['npm install'],
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
        { name: 'api', role: 'child', source: '/repos/api', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunSetupCommands.mockReturnValue([
      { command: 'npm install', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100 },
    ]);

    const result = await createWorkspace('feature-x', {
      from: '/repos/project',
      childRepos: [{ path: '/repos/api', name: 'api' }],
    });

    // Setup commands should still run (from config)
    expect(mockRunSetupCommands).toHaveBeenCalledTimes(2); // parent + child
    expect(result.setup).toHaveLength(2);
  });

  it('childRepos provided + config with hooks → childRepos wins, hooks from config still run', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [{ path: 'config-repo' }],
      hooks: { postCreate: './scripts/post-create.sh' },
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
        { name: 'api', role: 'child', source: '/repos/api', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunHook.mockReturnValue({
      command: './scripts/post-create.sh',
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      durationMs: 50,
    });

    const result = await createWorkspace('feature-x', {
      from: '/repos/project',
      childRepos: [{ path: '/repos/api', name: 'api' }],
    });

    // Config repo list should be ignored (childRepos wins)
    expect(mockValidateRepoPaths).not.toHaveBeenCalled();

    // Hook from config should still run
    expect(mockRunHook).toHaveBeenCalledWith(
      './scripts/post-create.sh',
      '/home/user/worktrees/project/feature-x',
    );
    expect(result.hookResult).toMatchObject({
      command: './scripts/post-create.sh',
      exitCode: 0,
    });
  });

  it('childRepos provided + config with setup and hooks → full lifecycle from config', async () => {
    mockLoadWorkspaceConfig.mockReturnValue({
      repos: [{ path: 'config-repo' }],
      setup: ['npm install'],
      hooks: { postCreate: './scripts/post-create.sh' },
    });

    mockPreflightCreate.mockResolvedValue({
      ok: true,
      sources: [
        { name: 'project', role: 'parent', source: '/repos/project', parentBranch: 'main' },
        { name: 'api', role: 'child', source: '/repos/api', parentBranch: 'main' },
      ],
      workspaceId: 'project-feature-x',
      worktreeBase: '/home/user/worktrees',
    });

    mockRunSetupCommands.mockReturnValue([
      { command: 'npm install', exitCode: 0, stdout: 'ok', stderr: '', durationMs: 100 },
    ]);

    mockRunHook.mockReturnValue({
      command: './scripts/post-create.sh',
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      durationMs: 50,
    });

    const result = await createWorkspace('feature-x', {
      from: '/repos/project',
      childRepos: [{ path: '/repos/api', name: 'api' }],
    });

    // childRepos used for repo list
    const preflightSources = mockPreflightCreate.mock.calls[0][0];
    expect(preflightSources).toEqual([
      { path: '/repos/project', role: 'parent' },
      { path: '/repos/api', role: 'child', name: 'api' },
    ]);

    // Setup from config runs in all worktrees
    expect(mockRunSetupCommands).toHaveBeenCalledTimes(2);

    // Hook from config runs
    expect(mockRunHook).toHaveBeenCalledTimes(1);
    expect(result.setup).toHaveLength(2);
    expect(result.hookResult).toBeDefined();
  });
});
