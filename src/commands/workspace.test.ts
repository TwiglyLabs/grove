import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceCommand } from './workspace.js';
import { ConflictError } from '../workspace/sync.js';

// Mock workspace modules
const mockCreateWorkspace = vi.hoisted(() => vi.fn());
const mockListWorkspaces = vi.hoisted(() => vi.fn());
const mockGetWorkspaceStatus = vi.hoisted(() => vi.fn());
const mockSyncWorkspace = vi.hoisted(() => vi.fn());
const mockCloseWorkspace = vi.hoisted(() => vi.fn());
const mockReadWorkspaceState = vi.hoisted(() => vi.fn());
const mockFindWorkspaceByBranch = vi.hoisted(() => vi.fn());

// Mock output functions
const mockPrintSuccess = vi.hoisted(() => vi.fn());
const mockPrintError = vi.hoisted(() => vi.fn());
const mockPrintInfo = vi.hoisted(() => vi.fn());
const mockPrintWarning = vi.hoisted(() => vi.fn());
const mockJsonSuccess = vi.hoisted(() => vi.fn());
const mockJsonError = vi.hoisted(() => vi.fn());

vi.mock('../workspace/create.js', () => ({
  createWorkspace: mockCreateWorkspace,
}));

vi.mock('../workspace/status.js', () => ({
  listWorkspaces: mockListWorkspaces,
  getWorkspaceStatus: mockGetWorkspaceStatus,
}));

vi.mock('../workspace/sync.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../workspace/sync.js')>();
  return {
    syncWorkspace: mockSyncWorkspace,
    ConflictError: orig.ConflictError,
  };
});

vi.mock('../workspace/close.js', () => ({
  closeWorkspace: mockCloseWorkspace,
}));

vi.mock('../workspace/state.js', () => ({
  readWorkspaceState: mockReadWorkspaceState,
  findWorkspaceByBranch: mockFindWorkspaceByBranch,
}));

vi.mock('../shared/output.js', () => ({
  printSuccess: mockPrintSuccess,
  printError: mockPrintError,
  printInfo: mockPrintInfo,
  printWarning: mockPrintWarning,
  jsonSuccess: mockJsonSuccess,
  jsonError: mockJsonError,
}));

// Mock console.log to prevent output noise
vi.spyOn(console, 'log').mockImplementation(() => {});

describe('workspaceCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
  });

  describe('create subcommand', () => {
    it('should call createWorkspace with branch name', async () => {
      mockCreateWorkspace.mockResolvedValue({ id: 'ws-1', root: '/path/to/workspace', repos: ['myproject'], branch: 'feature-branch' });

      await workspaceCommand(['create', 'feature-branch']);

      expect(mockCreateWorkspace).toHaveBeenCalledWith('feature-branch', {});
      expect(mockPrintSuccess).toHaveBeenCalled();
    });

    it('should pass --from flag to createWorkspace', async () => {
      mockCreateWorkspace.mockResolvedValue({ id: 'ws-1', root: '/path/to/workspace', repos: ['myproject'], branch: 'feature-branch' });

      await workspaceCommand(['create', 'feature-branch', '--from', 'develop']);

      expect(mockCreateWorkspace).toHaveBeenCalledWith('feature-branch', { from: 'develop' });
    });

    it('should call jsonSuccess when --json flag is provided', async () => {
      const result = { id: 'ws-1', root: '/path/to/workspace', repos: ['myproject'], branch: 'feature-branch' };
      mockCreateWorkspace.mockResolvedValue(result);

      await workspaceCommand(['create', 'feature-branch', '--json']);

      expect(mockCreateWorkspace).toHaveBeenCalledWith('feature-branch', {});
      expect(mockJsonSuccess).toHaveBeenCalledWith(result);
      expect(mockPrintSuccess).not.toHaveBeenCalled();
    });

    it('should handle --json and --from flags together', async () => {
      const result = { id: 'ws-1', root: '/path/to/workspace', repos: ['myproject'], branch: 'feature-branch' };
      mockCreateWorkspace.mockResolvedValue(result);

      await workspaceCommand(['create', 'feature-branch', '--from', 'develop', '--json']);

      expect(mockCreateWorkspace).toHaveBeenCalledWith('feature-branch', { from: 'develop' });
      expect(mockJsonSuccess).toHaveBeenCalledWith(result);
    });

    it('should print error when branch name is missing', async () => {
      await workspaceCommand(['create']);

      expect(mockCreateWorkspace).not.toHaveBeenCalled();
      expect(mockPrintError).toHaveBeenCalledWith('Usage: grove workspace create <branch> [--from <path>]');
    });

    it('should print error when createWorkspace fails', async () => {
      mockCreateWorkspace.mockRejectedValue(new Error('Failed to create workspace'));

      await workspaceCommand(['create', 'feature-branch']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to create workspace');
    });

    it('should call jsonError when createWorkspace fails with --json', async () => {
      mockCreateWorkspace.mockRejectedValue(new Error('Failed to create workspace'));

      await workspaceCommand(['create', 'feature-branch', '--json']);

      expect(mockJsonError).toHaveBeenCalledWith('Failed to create workspace');
      expect(mockPrintError).not.toHaveBeenCalled();
    });
  });

  describe('list subcommand', () => {
    it('should call listWorkspaces', async () => {
      const workspaces = [
        { id: 'ws-1', branch: 'feature-1', root: '/path/1', status: 'active' },
        { id: 'ws-2', branch: 'feature-2', root: '/path/2', status: 'active' },
      ];
      mockListWorkspaces.mockReturnValue(workspaces);

      await workspaceCommand(['list']);

      expect(mockListWorkspaces).toHaveBeenCalled();
      expect(console.log).toHaveBeenCalled();
    });

    it('should call jsonSuccess when --json flag is provided', async () => {
      const workspaces = [
        { id: 'ws-1', branch: 'feature-1', root: '/path/1', status: 'active' },
      ];
      mockListWorkspaces.mockReturnValue(workspaces);

      await workspaceCommand(['list', '--json']);

      expect(mockListWorkspaces).toHaveBeenCalled();
      expect(mockJsonSuccess).toHaveBeenCalledWith({ workspaces });
    });

    it('should handle empty workspace list', async () => {
      mockListWorkspaces.mockReturnValue([]);

      await workspaceCommand(['list']);

      expect(mockListWorkspaces).toHaveBeenCalled();
      expect(mockPrintInfo).toHaveBeenCalledWith('No workspaces found');
    });

    it('should handle list failure', async () => {
      mockListWorkspaces.mockImplementation(() => {
        throw new Error('Failed to list');
      });

      await workspaceCommand(['list']);

      expect(mockPrintError).toHaveBeenCalledWith('Failed to list');
    });
  });

  describe('status subcommand', () => {
    it('should call getWorkspaceStatus with branch name', async () => {
      const status = { id: 'ws-1', branch: 'feature-branch', status: 'active', repos: [] };
      mockGetWorkspaceStatus.mockReturnValue(status);

      await workspaceCommand(['status', 'feature-branch']);

      expect(mockGetWorkspaceStatus).toHaveBeenCalledWith('feature-branch');
      expect(console.log).toHaveBeenCalled();
    });

    it('should call getWorkspaceStatus without branch (current workspace)', async () => {
      const status = { id: 'ws-1', branch: 'current-branch', status: 'active', repos: [] };
      mockGetWorkspaceStatus.mockReturnValue(status);

      await workspaceCommand(['status']);

      expect(mockGetWorkspaceStatus).toHaveBeenCalledWith(undefined);
      expect(console.log).toHaveBeenCalled();
    });

    it('should call jsonSuccess when --json flag is provided', async () => {
      const status = { id: 'ws-1', branch: 'feature-branch', status: 'active', repos: [] };
      mockGetWorkspaceStatus.mockReturnValue(status);

      await workspaceCommand(['status', 'feature-branch', '--json']);

      expect(mockGetWorkspaceStatus).toHaveBeenCalledWith('feature-branch');
      expect(mockJsonSuccess).toHaveBeenCalledWith(status);
    });

    it('should handle status failure', async () => {
      mockGetWorkspaceStatus.mockImplementation(() => {
        throw new Error('Workspace not found');
      });

      await workspaceCommand(['status', 'feature-branch']);

      expect(mockPrintError).toHaveBeenCalledWith('Workspace not found');
    });
  });

  describe('sync subcommand', () => {
    it('should call syncWorkspace with branch name', async () => {
      mockSyncWorkspace.mockResolvedValue({ synced: ['myproject'] });

      await workspaceCommand(['sync', 'feature-branch']);

      expect(mockSyncWorkspace).toHaveBeenCalledWith('feature-branch');
      expect(mockPrintSuccess).toHaveBeenCalled();
    });

    it('should print error when branch is missing', async () => {
      await workspaceCommand(['sync']);

      expect(mockSyncWorkspace).not.toHaveBeenCalled();
      expect(mockPrintError).toHaveBeenCalledWith('Usage: grove workspace sync <branch>');
    });

    it('should call jsonError when branch is missing with --json', async () => {
      await workspaceCommand(['sync', '--json']);

      expect(mockSyncWorkspace).not.toHaveBeenCalled();
      expect(mockJsonError).toHaveBeenCalledWith('Usage: grove workspace sync <branch>');
    });

    it('should call jsonSuccess when --json flag is provided', async () => {
      const result = { synced: ['myproject', 'public'] };
      mockSyncWorkspace.mockResolvedValue(result);

      await workspaceCommand(['sync', 'feature-branch', '--json']);

      expect(mockSyncWorkspace).toHaveBeenCalledWith('feature-branch');
      expect(mockJsonSuccess).toHaveBeenCalledWith(result);
    });

    it('should handle sync failure', async () => {
      mockSyncWorkspace.mockRejectedValue(new Error('Sync failed'));

      await workspaceCommand(['sync', 'feature-branch']);

      expect(mockPrintError).toHaveBeenCalledWith('Sync failed');
    });

    it('should pass ConflictError structured data to jsonError', async () => {
      mockSyncWorkspace.mockRejectedValue(
        new ConflictError('Merge conflicts in public', 'public', ['src/schema.ts'], ['acorn'], ['cloud']),
      );

      await workspaceCommand(['sync', 'feature-branch', '--json']);

      expect(mockJsonError).toHaveBeenCalledWith('Merge conflicts in public', {
        conflicted: 'public',
        files: ['src/schema.ts'],
        resolved: ['acorn'],
        pending: ['cloud'],
      });
    });

    it('should print ConflictError message without structured data in text mode', async () => {
      mockSyncWorkspace.mockRejectedValue(
        new ConflictError('Merge conflicts in public', 'public', ['src/schema.ts'], ['acorn'], ['cloud']),
      );

      await workspaceCommand(['sync', 'feature-branch']);

      expect(mockPrintError).toHaveBeenCalledWith('Merge conflicts in public');
      expect(mockJsonError).not.toHaveBeenCalled();
    });
  });

  describe('close subcommand', () => {
    it('should call closeWorkspace with branch and merge mode', async () => {
      mockCloseWorkspace.mockResolvedValue(undefined);

      await workspaceCommand(['close', 'feature-branch', '--merge']);

      expect(mockCloseWorkspace).toHaveBeenCalledWith('feature-branch', 'merge', { dryRun: false });
      expect(mockPrintSuccess).toHaveBeenCalled();
    });

    it('should call closeWorkspace with branch and discard mode', async () => {
      mockCloseWorkspace.mockResolvedValue(undefined);

      await workspaceCommand(['close', 'feature-branch', '--discard']);

      expect(mockCloseWorkspace).toHaveBeenCalledWith('feature-branch', 'discard', { dryRun: false });
      expect(mockPrintSuccess).toHaveBeenCalled();
    });

    it('should call jsonSuccess when --json flag is provided with --merge', async () => {
      mockCloseWorkspace.mockResolvedValue(undefined);

      await workspaceCommand(['close', 'feature-branch', '--merge', '--json']);

      expect(mockCloseWorkspace).toHaveBeenCalledWith('feature-branch', 'merge', { dryRun: false });
      expect(mockJsonSuccess).toHaveBeenCalledWith({ branch: 'feature-branch', mode: 'merge' });
    });

    it('should print error when branch name is missing', async () => {
      await workspaceCommand(['close', '--merge']);

      expect(mockCloseWorkspace).not.toHaveBeenCalled();
      expect(mockPrintError).toHaveBeenCalledWith('Usage: grove workspace close <branch> --merge|--discard [--dry-run]');
    });

    it('should print error when close mode is missing', async () => {
      await workspaceCommand(['close', 'feature-branch']);

      expect(mockCloseWorkspace).not.toHaveBeenCalled();
      expect(mockPrintError).toHaveBeenCalledWith('Usage: grove workspace close <branch> --merge|--discard [--dry-run]');
    });

    it('should handle close failure', async () => {
      mockCloseWorkspace.mockRejectedValue(new Error('Close failed'));

      await workspaceCommand(['close', 'feature-branch', '--merge']);

      expect(mockPrintError).toHaveBeenCalledWith('Close failed');
    });
  });

  describe('switch subcommand', () => {
    it('should print workspace root path', async () => {
      mockReadWorkspaceState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue({
        id: 'myproject-feature-x',
        root: '/tmp/worktrees/myproject/feature-x',
        branch: 'feature-x',
      });

      await workspaceCommand(['switch', 'feature-x']);

      expect(console.log).toHaveBeenCalledWith('/tmp/worktrees/myproject/feature-x');
    });

    it('should find workspace by ID first', async () => {
      mockReadWorkspaceState.mockReturnValue({
        id: 'myproject-feature-x',
        root: '/tmp/worktrees/myproject/feature-x',
        branch: 'feature-x',
      });

      await workspaceCommand(['switch', 'myproject-feature-x']);

      expect(mockReadWorkspaceState).toHaveBeenCalledWith('myproject-feature-x');
      expect(mockFindWorkspaceByBranch).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith('/tmp/worktrees/myproject/feature-x');
    });

    it('should return JSON when --json flag is provided', async () => {
      mockReadWorkspaceState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue({
        id: 'myproject-feature-x',
        root: '/tmp/worktrees/myproject/feature-x',
        branch: 'feature-x',
      });

      await workspaceCommand(['switch', 'feature-x', '--json']);

      expect(mockJsonSuccess).toHaveBeenCalledWith({ path: '/tmp/worktrees/myproject/feature-x' });
    });

    it('should print error when branch name is missing', async () => {
      await workspaceCommand(['switch']);

      expect(mockPrintError).toHaveBeenCalledWith('Usage: grove workspace switch <branch>');
    });

    it('should print error when workspace not found', async () => {
      mockReadWorkspaceState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(null);

      await workspaceCommand(['switch', 'nonexistent']);

      expect(mockPrintError).toHaveBeenCalledWith("No workspace found for 'nonexistent'");
    });

    it('should call jsonError when workspace not found with --json', async () => {
      mockReadWorkspaceState.mockReturnValue(null);
      mockFindWorkspaceByBranch.mockReturnValue(null);

      await workspaceCommand(['switch', 'nonexistent', '--json']);

      expect(mockJsonError).toHaveBeenCalledWith("No workspace found for 'nonexistent'");
      expect(mockPrintError).not.toHaveBeenCalled();
    });
  });

  describe('help subcommand', () => {
    it('should print general help for "help" with no target', async () => {
      await workspaceCommand(['help']);

      expect(console.log).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(output).toContain('grove workspace <command>');
      expect(output).toContain('create');
      expect(output).toContain('close');
    });

    it('should print subcommand help for "help create"', async () => {
      await workspaceCommand(['help', 'create']);

      expect(console.log).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(output).toContain('grove workspace create');
      expect(output).toContain('--from');
    });

    it('should print subcommand help with --help flag', async () => {
      await workspaceCommand(['sync', '--help']);

      expect(console.log).toHaveBeenCalled();
      const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(output).toContain('grove workspace sync');
      expect(output).toContain('--verbose');
    });

    it('should not execute the subcommand when --help is passed', async () => {
      await workspaceCommand(['create', '--help']);

      expect(mockCreateWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('unknown subcommand', () => {
    it('should print usage for unknown subcommand', async () => {
      await workspaceCommand(['unknown']);

      expect(mockPrintError).toHaveBeenCalledWith('Unknown workspace subcommand: unknown');
      expect(process.exitCode).toBe(1);
    });

    it('should print usage when no subcommand provided', async () => {
      await workspaceCommand([]);

      // Should print usage but not error
      expect(mockPrintError).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });
});
