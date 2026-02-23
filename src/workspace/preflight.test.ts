import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preflightCreate, validateRepoPaths, validateBranchName } from './preflight.js';
import type { SourceRepo } from './preflight.js';

// Mock dependencies using vi.hoisted
const { mockIsGitRepo, mockGetCurrentBranch, mockBranchExists, mockGetWorktreeBasePath, mockValidateWorktreeBasePath, mockReadWorkspaceState } = vi.hoisted(() => ({
  mockIsGitRepo: vi.fn(),
  mockGetCurrentBranch: vi.fn(),
  mockBranchExists: vi.fn(),
  mockGetWorktreeBasePath: vi.fn(),
  mockValidateWorktreeBasePath: vi.fn(),
  mockReadWorkspaceState: vi.fn(),
}));

vi.mock('./git.js', () => ({
  isGitRepo: mockIsGitRepo,
  getCurrentBranch: mockGetCurrentBranch,
  branchExists: mockBranchExists,
  getWorktreeBasePath: mockGetWorktreeBasePath,
  validateWorktreeBasePath: mockValidateWorktreeBasePath,
}));

vi.mock('./state.js', () => ({
  readWorkspaceState: mockReadWorkspaceState,
}));

describe('preflightCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorktreeBasePath.mockReturnValue('/home/user/worktrees');
    mockValidateWorktreeBasePath.mockReturnValue(null);
  });

  it('all repos valid → returns ok', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/repos/lib', role: 'child' as const },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.workspaceId).toBe('project-feature-x');
    expect(result.worktreeBase).toBe('/home/user/worktrees');
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0]).toEqual({
      name: 'project',
      role: 'parent',
      source: '/repos/project',
      parentBranch: 'main',
    });
    expect(result.sources[1]).toEqual({
      name: 'lib',
      role: 'child',
      source: '/repos/lib',
      parentBranch: 'main',
    });
  });

  it('one source not a git repo → error', async () => {
    mockIsGitRepo.mockImplementation((path: string) => path !== '/not/a/repo');
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/not/a/repo', role: 'child' as const },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe('Not a git repository: /not/a/repo');
  });

  it('branch already exists in one repo → error', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockImplementation((path: string, branch: string) => {
      return path === '/repos/lib' && branch === 'feature-x';
    });
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/repos/lib', role: 'child' as const },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Branch 'feature-x' already exists in lib");
  });

  it('grouped workspace with repos on different branches → error with details', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockImplementation((path: string) => {
      if (path === '/repos/project') return 'main';
      if (path === '/repos/lib') return 'develop';
      return 'main';
    });
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/repos/lib', role: 'child' as const },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Repos are on different branches');
    expect(result.errors[0]).toContain('project: main');
    expect(result.errors[0]).toContain('lib: develop');
  });

  it('existing active workspace → error', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue({
      version: 1,
      id: 'project-feature-x',
      status: 'active',
      branch: 'feature-x',
      createdAt: '2026-02-14T10:00:00Z',
      updatedAt: '2026-02-14T10:00:00Z',
      root: '/home/user/worktrees/project/feature-x',
      source: '/repos/project',
      repos: [],
      sync: null,
    });

    const sources = [{ path: '/repos/project', role: 'parent' as const }];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Workspace 'project-feature-x' already exists with status 'active'");
  });

  it('existing failed workspace → ok (allowed)', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue({
      version: 1,
      id: 'project-feature-x',
      status: 'failed',
      branch: 'feature-x',
      createdAt: '2026-02-14T10:00:00Z',
      updatedAt: '2026-02-14T10:00:00Z',
      root: '/home/user/worktrees/project/feature-x',
      source: '/repos/project',
      repos: [],
      sync: null,
    });

    const sources = [{ path: '/repos/project', role: 'parent' as const }];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.workspaceId).toBe('project-feature-x');
  });

  it('simple workspace (single source) skips branch consistency check', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('develop');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [{ path: '/repos/project', role: 'parent' as const }];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sources[0].parentBranch).toBe('develop');
  });

  it('all repos on same branch → ok', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/repos/public', role: 'child' as const },
      { path: '/repos/cloud', role: 'child' as const },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sources).toHaveLength(3);
    expect(result.sources.every(s => s.parentBranch === 'main')).toBe(true);
  });

  it('uses custom name when provided', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/repos/library-name', role: 'child' as const, name: 'lib' },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sources[1].name).toBe('lib');
  });

  it('detached HEAD in source repo → error', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockImplementation((path: string) => {
      if (path === '/repos/lib') return '';
      return 'main';
    });
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);

    const sources = [
      { path: '/repos/project', role: 'parent' as const },
      { path: '/repos/lib', role: 'child' as const },
    ];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('detached HEAD');
    expect(result.errors[0]).toContain('lib');
  });

  it('worktree base path not writable → error', async () => {
    mockIsGitRepo.mockReturnValue(true);
    mockGetCurrentBranch.mockReturnValue('main');
    mockBranchExists.mockReturnValue(false);
    mockReadWorkspaceState.mockResolvedValue(null);
    mockValidateWorktreeBasePath.mockReturnValue('Worktree base path is not writable: /readonly/path');

    const sources = [{ path: '/repos/project', role: 'parent' as const }];

    const result = await preflightCreate(sources, 'feature-x');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('not writable');
  });

  it('invalid branch name → error before git checks', async () => {
    const sources = [{ path: '/repos/project', role: 'parent' as const }];

    const result = await preflightCreate(sources, 'feature branch');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors[0]).toContain('whitespace');
    // Should not have called any git functions
    expect(mockIsGitRepo).not.toHaveBeenCalled();
  });
});

describe('validateRepoPaths', () => {
  it('accepts valid relative paths', () => {
    expect(validateRepoPaths(['public', 'cloud'])).toEqual([]);
  });

  it('accepts nested relative paths', () => {
    expect(validateRepoPaths(['packages/lib', 'packages/app'])).toEqual([]);
  });

  it('rejects paths with ..', () => {
    const errors = validateRepoPaths(['../sibling', 'public']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("must not contain '..'");
    expect(errors[0]).toContain('../sibling');
  });

  it('rejects paths with .. in the middle', () => {
    const errors = validateRepoPaths(['packages/../escape']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("must not contain '..'");
  });

  it('rejects absolute paths (unix)', () => {
    const errors = validateRepoPaths(['/usr/local/repo']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('must be relative');
  });

  it('rejects absolute paths (windows)', () => {
    const errors = validateRepoPaths(['C:\\repos\\project']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('must be relative');
  });

  it('rejects duplicate paths', () => {
    const errors = validateRepoPaths(['public', 'cloud', 'public']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Duplicate');
    expect(errors[0]).toContain('public');
  });

  it('reports multiple errors at once', () => {
    const errors = validateRepoPaths(['../bad', '/absolute', 'ok', 'ok']);
    expect(errors).toHaveLength(3); // .., absolute, duplicate
  });
});

describe('validateBranchName', () => {
  it('accepts valid branch names', () => {
    expect(validateBranchName('feature-x')).toBeNull();
    expect(validateBranchName('fix/login-bug')).toBeNull();
    expect(validateBranchName('release-1.0')).toBeNull();
  });

  it('rejects empty branch name', () => {
    expect(validateBranchName('')).toContain('empty');
  });

  it('rejects whitespace in branch name', () => {
    expect(validateBranchName('my branch')).toContain('whitespace');
  });

  it('rejects special git characters', () => {
    expect(validateBranchName('feature~1')).toContain('invalid characters');
    expect(validateBranchName('feature^2')).toContain('invalid characters');
    expect(validateBranchName('feature:bar')).toContain('invalid characters');
    expect(validateBranchName('feature?')).toContain('invalid characters');
    expect(validateBranchName('feature*')).toContain('invalid characters');
    expect(validateBranchName('feature[0]')).toContain('invalid characters');
    expect(validateBranchName('feature\\bar')).toContain('invalid characters');
  });

  it('rejects .. in branch name', () => {
    expect(validateBranchName('feature..bar')).toContain('..');
  });

  it('rejects invalid format', () => {
    expect(validateBranchName('/feature')).toContain('invalid format');
    expect(validateBranchName('feature/')).toContain('invalid format');
    expect(validateBranchName('feature.')).toContain('invalid format');
    expect(validateBranchName('feature.lock')).toContain('invalid format');
  });

  it('rejects @{ in branch name', () => {
    expect(validateBranchName('feature@{0}')).toContain('@{');
  });
});
