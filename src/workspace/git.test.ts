import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';

// Mock dependencies using vi.hoisted
const mockExecSync = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockAccessSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  accessSync: mockAccessSync,
  constants: {
    W_OK: 2,
  },
}));

// Import after mocks are set up
import {
  getWorktreeBasePath,
  validateWorktreeBasePath,
  isGitRepo,
  getCurrentBranch,
  branchExists,
  createWorktree,
  removeWorktree,
  deleteBranch,
  getRepoStatus,
  isMergeInProgress,
  getConflictedFiles,
  hasDirtyWorkingTree,
  fetch,
  merge,
  mergeFFOnly,
  canFFMerge,
  checkout,
  mergeAbort,
} from './git';

describe('git operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GROVE_WORKTREE_DIR;
  });

  describe('getWorktreeBasePath', () => {
    it('returns default path when GROVE_WORKTREE_DIR not set', () => {
      const result = getWorktreeBasePath();
      expect(result).toBe(join(homedir(), 'worktrees'));
    });

    it('returns GROVE_WORKTREE_DIR when set', () => {
      process.env.GROVE_WORKTREE_DIR = '/custom/worktree/path';
      const result = getWorktreeBasePath();
      expect(result).toBe('/custom/worktree/path');
    });
  });

  describe('validateWorktreeBasePath', () => {
    it('returns null when base path exists and is writable', () => {
      mockExistsSync.mockReturnValue(true);
      mockAccessSync.mockReturnValue(undefined); // accessSync returns nothing on success

      const result = validateWorktreeBasePath();
      expect(result).toBeNull();
      expect(mockAccessSync).toHaveBeenCalledWith(join(homedir(), 'worktrees'), 2); // W_OK = 2
    });

    it('returns null when base path does not exist but parent is writable', () => {
      mockExistsSync.mockImplementation((path: string) => {
        // Base path doesn't exist, but parent does
        return path === join(join(homedir(), 'worktrees'), '..');
      });
      mockAccessSync.mockReturnValue(undefined);

      const result = validateWorktreeBasePath();
      expect(result).toBeNull();
    });

    it('returns error when base path exists but is not writable', () => {
      mockExistsSync.mockReturnValue(true);
      mockAccessSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = validateWorktreeBasePath();
      expect(result).toContain('not writable');
      expect(result).toContain(join(homedir(), 'worktrees'));
    });

    it('returns error when base path does not exist and parent is not writable', () => {
      mockExistsSync.mockImplementation((path: string) => {
        // Base path doesn't exist, parent exists
        return path === join(join(homedir(), 'worktrees'), '..');
      });
      mockAccessSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = validateWorktreeBasePath();
      expect(result).toContain('not writable');
    });

    it('returns error when base path does not exist and parent does not exist', () => {
      mockExistsSync.mockReturnValue(false); // Nothing exists

      const result = validateWorktreeBasePath();
      expect(result).toContain('parent does not exist');
    });

    it('respects GROVE_WORKTREE_DIR environment variable', () => {
      process.env.GROVE_WORKTREE_DIR = '/custom/path';
      mockExistsSync.mockReturnValue(true);
      mockAccessSync.mockReturnValue(undefined);

      const result = validateWorktreeBasePath();
      expect(result).toBeNull();
      expect(mockAccessSync).toHaveBeenCalledWith('/custom/path', 2);
    });
  });

  describe('isGitRepo', () => {
    it('returns false when path does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(isGitRepo('/nonexistent')).toBe(false);
      expect(mockExistsSync).toHaveBeenCalledWith('/nonexistent');
    });

    it('returns true when git rev-parse succeeds', () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue('.git\n');

      expect(isGitRepo('/repo')).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git rev-parse --git-dir',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('returns false when git rev-parse fails', () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      expect(isGitRepo('/not-a-repo')).toBe(false);
    });
  });

  describe('getCurrentBranch', () => {
    it('returns current branch name', () => {
      mockExecSync.mockReturnValue('main\n');

      const result = getCurrentBranch('/repo');
      expect(result).toBe('main');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git branch --show-current',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('handles branches with special characters', () => {
      mockExecSync.mockReturnValue('feature/my-branch\n');

      const result = getCurrentBranch('/repo');
      expect(result).toBe('feature/my-branch');
    });

    it('throws when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      expect(() => getCurrentBranch('/repo')).toThrow();
    });
  });

  describe('branchExists', () => {
    it('returns true when branch exists', () => {
      mockExecSync.mockReturnValue('abc123\n');

      expect(branchExists('/repo', 'feature')).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git rev-parse --verify feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('returns false when branch does not exist', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a valid ref');
      });

      expect(branchExists('/repo', 'nonexistent')).toBe(false);
    });
  });

  describe('createWorktree', () => {
    it('creates worktree with new branch', () => {
      mockExecSync.mockReturnValue('');

      createWorktree('/repo', 'feature', '/worktrees/feature');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git worktree add -b feature /worktrees/feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('throws when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('worktree add failed');
      });

      expect(() => createWorktree('/repo', 'feature', '/target')).toThrow();
    });
  });

  describe('removeWorktree', () => {
    it('removes worktree without force flag', () => {
      mockExecSync.mockReturnValue('');

      removeWorktree('/repo', '/worktrees/feature');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git worktree remove /worktrees/feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('removes worktree with force flag', () => {
      mockExecSync.mockReturnValue('');

      removeWorktree('/repo', '/worktrees/feature', true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git worktree remove --force /worktrees/feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('throws when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('worktree remove failed');
      });

      expect(() => removeWorktree('/repo', '/target')).toThrow();
    });
  });

  describe('deleteBranch', () => {
    it('deletes branch with -d flag by default', () => {
      mockExecSync.mockReturnValue('');

      deleteBranch('/repo', 'feature');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git branch -d feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('deletes branch with -D flag when force is true', () => {
      mockExecSync.mockReturnValue('');

      deleteBranch('/repo', 'feature', true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git branch -D feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('throws when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('branch delete failed');
      });

      expect(() => deleteBranch('/repo', 'feature')).toThrow();
    });
  });

  describe('getRepoStatus', () => {
    it('returns zero dirty files and commits when clean', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('status --porcelain')) return '';
        if (cmd.includes('branch --show-current')) return 'feature';
        if (cmd.includes('rev-list --count')) return '0';
        return '';
      });

      const result = getRepoStatus('/worktree', 'main');
      expect(result).toEqual({ dirty: 0, commits: 0 });
    });

    it('returns dirty file count when files are modified', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('status --porcelain')) return ' M file1.ts\n M file2.ts\n';
        if (cmd.includes('branch --show-current')) return 'feature';
        if (cmd.includes('rev-list --count')) return '0';
        return '';
      });

      const result = getRepoStatus('/worktree', 'main');
      expect(result.dirty).toBe(2);
    });

    it('returns commit count when ahead of parent', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('status --porcelain')) return '';
        if (cmd.includes('branch --show-current')) return 'feature';
        if (cmd.includes('rev-list --count main..feature')) return '5';
        return '';
      });

      const result = getRepoStatus('/worktree', 'main');
      expect(result.commits).toBe(5);
    });

    it('filters empty lines from status output', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('status --porcelain')) return ' M file1.ts\n\n M file2.ts\n\n';
        if (cmd.includes('branch --show-current')) return 'feature';
        if (cmd.includes('rev-list --count')) return '0';
        return '';
      });

      const result = getRepoStatus('/worktree', 'main');
      expect(result.dirty).toBe(2);
    });

    it('handles git command failures gracefully', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('status --porcelain')) throw new Error('status failed');
        if (cmd.includes('branch --show-current')) return 'feature';
        if (cmd.includes('rev-list --count')) throw new Error('rev-list failed');
        return '';
      });

      const result = getRepoStatus('/worktree', 'main');
      expect(result).toEqual({ dirty: 0, commits: 0 });
    });

    it('handles non-numeric commit count', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('status --porcelain')) return '';
        if (cmd.includes('branch --show-current')) return 'feature';
        if (cmd.includes('rev-list --count')) return 'invalid';
        return '';
      });

      const result = getRepoStatus('/worktree', 'main');
      expect(result.commits).toBe(0);
    });
  });

  describe('isMergeInProgress', () => {
    it('returns false when git-dir command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      expect(isMergeInProgress('/worktree')).toBe(false);
    });

    it('returns false when MERGE_HEAD does not exist', () => {
      mockExecSync.mockReturnValue('.git');
      mockExistsSync.mockReturnValue(false);

      expect(isMergeInProgress('/worktree')).toBe(false);
      expect(mockExistsSync).toHaveBeenCalledWith(join('.git', 'MERGE_HEAD'));
    });

    it('returns true when MERGE_HEAD exists', () => {
      mockExecSync.mockReturnValue('.git');
      mockExistsSync.mockReturnValue(true);

      expect(isMergeInProgress('/worktree')).toBe(true);
      expect(mockExistsSync).toHaveBeenCalledWith(join('.git', 'MERGE_HEAD'));
    });

    it('handles git-dir with leading/trailing whitespace', () => {
      mockExecSync.mockReturnValue('  .git  \n');
      mockExistsSync.mockReturnValue(true);

      expect(isMergeInProgress('/worktree')).toBe(true);
      expect(mockExistsSync).toHaveBeenCalledWith(join('.git', 'MERGE_HEAD'));
    });
  });

  describe('getConflictedFiles', () => {
    it('returns empty array when no conflicts', () => {
      mockExecSync.mockReturnValue('');

      const result = getConflictedFiles('/worktree');
      expect(result).toEqual([]);
    });

    it('returns conflicted file names', () => {
      mockExecSync.mockReturnValue('file1.ts\nfile2.ts\n');

      const result = getConflictedFiles('/worktree');
      expect(result).toEqual(['file1.ts', 'file2.ts']);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git diff --name-only --diff-filter=U',
        expect.objectContaining({ cwd: '/worktree' })
      );
    });

    it('filters empty lines', () => {
      mockExecSync.mockReturnValue('file1.ts\n\nfile2.ts\n\n');

      const result = getConflictedFiles('/worktree');
      expect(result).toEqual(['file1.ts', 'file2.ts']);
    });

    it('returns empty array when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('diff failed');
      });

      const result = getConflictedFiles('/worktree');
      expect(result).toEqual([]);
    });
  });

  describe('hasDirtyWorkingTree', () => {
    it('returns false when working tree is clean', () => {
      mockExecSync.mockReturnValue('');

      expect(hasDirtyWorkingTree('/worktree')).toBe(false);
    });

    it('returns true when working tree has changes', () => {
      mockExecSync.mockReturnValue(' M file.ts\n');

      expect(hasDirtyWorkingTree('/worktree')).toBe(true);
    });

    it('returns false when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('status failed');
      });

      expect(hasDirtyWorkingTree('/worktree')).toBe(false);
    });

    it('handles whitespace-only output as clean', () => {
      mockExecSync.mockReturnValue('   \n  ');

      expect(hasDirtyWorkingTree('/worktree')).toBe(false);
    });
  });

  describe('fetch', () => {
    it('fetches from origin', () => {
      mockExecSync.mockReturnValue('');

      fetch('/worktree');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git fetch origin',
        expect.objectContaining({ cwd: '/worktree' })
      );
    });

    it('throws when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fetch failed');
      });

      expect(() => fetch('/worktree')).toThrow();
    });
  });

  describe('merge', () => {
    it('returns ok true when merge succeeds', () => {
      mockExecSync.mockReturnValue('');

      const result = merge('/worktree', 'main');
      expect(result).toEqual({ ok: true, conflicts: [] });
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge main',
        expect.objectContaining({ cwd: '/worktree' })
      );
    });

    it('returns conflicts when merge fails', () => {
      let callCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: merge command fails
          throw new Error('merge conflict');
        }
        // Second call: diff to get conflicts
        return 'file1.ts\nfile2.ts\n';
      });

      const result = merge('/worktree', 'main');
      expect(result).toEqual({
        ok: false,
        conflicts: ['file1.ts', 'file2.ts'],
      });
    });

    it('returns empty conflicts array when diff fails', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('merge')) throw new Error('merge conflict');
        if (cmd.includes('diff')) throw new Error('diff failed');
        return '';
      });

      const result = merge('/worktree', 'main');
      expect(result).toEqual({ ok: false, conflicts: [] });
    });
  });

  describe('mergeFFOnly', () => {
    it('returns true when fast-forward merge succeeds', () => {
      mockExecSync.mockReturnValue('');

      const result = mergeFFOnly('/repo', 'feature');
      expect(result).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge --ff-only feature',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('returns false when fast-forward merge fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('cannot fast-forward');
      });

      const result = mergeFFOnly('/repo', 'feature');
      expect(result).toBe(false);
    });
  });

  describe('canFFMerge', () => {
    it('returns true when parent is ancestor of workspace branch', () => {
      // rev-parse --verify succeeds for both branches, merge-base --is-ancestor succeeds
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --verify')) return 'abc123\n';
        if (cmd.includes('merge-base --is-ancestor')) return '\n';
        return '';
      });

      expect(canFFMerge('/repo', 'main', 'feature-x')).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge-base --is-ancestor main feature-x',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('returns false when branches have diverged', () => {
      let callCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --verify')) return 'abc123\n';
        if (cmd.includes('merge-base --is-ancestor')) {
          throw new Error('not ancestor');
        }
        return '';
      });

      expect(canFFMerge('/repo', 'main', 'feature-x')).toBe(false);
    });

    it('throws when parent branch ref does not exist', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --verify main')) {
          throw new Error('not a valid ref');
        }
        return 'abc123\n';
      });

      expect(() => canFFMerge('/repo', 'main', 'feature-x')).toThrow(
        "Branch 'main' not found in /repo"
      );
    });

    it('throws when workspace branch ref does not exist', () => {
      let revParseCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --verify')) {
          revParseCount++;
          if (revParseCount === 1) return 'abc123\n'; // parent exists
          throw new Error('not a valid ref'); // workspace doesn't
        }
        return '';
      });

      expect(() => canFFMerge('/repo', 'main', 'feature-x')).toThrow(
        "Branch 'feature-x' not found in /repo"
      );
    });
  });

  describe('checkout', () => {
    it('checks out branch', () => {
      mockExecSync.mockReturnValue('');

      checkout('/repo', 'main');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git checkout main',
        expect.objectContaining({ cwd: '/repo' })
      );
    });

    it('throws when git command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('checkout failed');
      });

      expect(() => checkout('/repo', 'nonexistent')).toThrow();
    });
  });

  describe('mergeAbort', () => {
    it('aborts merge', () => {
      mockExecSync.mockReturnValue('');

      mergeAbort('/worktree');
      expect(mockExecSync).toHaveBeenCalledWith(
        'git merge --abort',
        expect.objectContaining({ cwd: '/worktree' })
      );
    });

    it('does not throw when merge abort fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('no merge in progress');
      });

      expect(() => mergeAbort('/worktree')).not.toThrow();
    });
  });
});
