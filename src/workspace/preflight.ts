import { basename, join } from 'path';
import { isGitRepo, getCurrentBranch, branchExists, getWorktreeBasePath, validateWorktreeBasePath } from './git.js';
import { readWorkspaceState } from './state.js';

/**
 * Build a filesystem-safe workspace ID from project name and branch.
 * Replaces `/` with `--` so branch names like `plan/dag-viewer` don't
 * create nested subdirectories in the state file path.
 */
export function toWorkspaceId(projectName: string, branch: string): string {
  return `${projectName}-${branch.replace(/\//g, '--')}`;
}

/**
 * Validate branch name for git compatibility.
 * Rejects names with characters that git doesn't allow.
 */
export function validateBranchName(branch: string): string | null {
  if (!branch || branch.trim() === '') {
    return 'Branch name cannot be empty';
  }
  if (/\s/.test(branch)) {
    return `Branch name cannot contain whitespace: '${branch}'`;
  }
  if (/[~^:?*\[\\]/.test(branch)) {
    return `Branch name contains invalid characters: '${branch}'`;
  }
  if (branch.includes('..')) {
    return `Branch name cannot contain '..': '${branch}'`;
  }
  if (branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.endsWith('.lock')) {
    return `Branch name has invalid format: '${branch}'`;
  }
  if (branch.includes('@{')) {
    return `Branch name cannot contain '@{': '${branch}'`;
  }
  return null;
}

export interface SourceRepo {
  name: string;
  role: 'parent' | 'child';
  source: string;
  parentBranch: string;
}

export interface PreflightResult {
  ok: true;
  sources: SourceRepo[];
  workspaceId: string;
  worktreeBase: string;
}

export interface PreflightError {
  ok: false;
  errors: string[];
}

/**
 * Validate workspace repo paths from config before resolving them.
 * Checks: no path traversal (..), no absolute paths, no duplicates.
 */
export function validateRepoPaths(
  paths: string[],
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const p of paths) {
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
      errors.push(`Workspace repo path must be relative: '${p}'`);
    }
    // Allow ../ prefix for sibling repos, reject .. elsewhere
    const rest = p.startsWith('../') ? p.slice(3) : p;
    if (rest.includes('..')) {
      errors.push(`Workspace repo path must not contain '..': '${p}'`);
    }
    if (seen.has(p)) {
      errors.push(`Duplicate workspace repo path: '${p}'`);
    }
    seen.add(p);
  }

  return errors;
}

export async function preflightCreate(
  sources: Array<{ path: string; role: 'parent' | 'child'; name?: string }>,
  branch: string,
): Promise<PreflightResult | PreflightError> {
  const errors: string[] = [];

  // Validate branch name
  const branchError = validateBranchName(branch);
  if (branchError) {
    errors.push(branchError);
    return { ok: false, errors };
  }

  // Verify all sources are git repos
  for (const s of sources) {
    if (!isGitRepo(s.path)) {
      errors.push(`Not a git repository: ${s.path}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Get current branch for each source and check consistency
  const branches = new Map<string, string>();
  const sourceRepos: SourceRepo[] = [];

  for (const s of sources) {
    const currentBranch = getCurrentBranch(s.path);
    const name = s.name || basename(s.path);

    // Reject detached HEAD
    if (!currentBranch) {
      errors.push(`Repository '${name}' is in detached HEAD state`);
      continue;
    }

    branches.set(name, currentBranch);
    sourceRepos.push({
      name,
      role: s.role,
      source: s.path,
      parentBranch: currentBranch,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Branch consistency check (only matters for grouped workspaces)
  if (sources.length > 1) {
    const uniqueBranches = new Set(branches.values());
    if (uniqueBranches.size > 1) {
      const details = Array.from(branches.entries())
        .map(([name, b]) => `  ${name}: ${b}`)
        .join('\n');
      errors.push(`Repos are on different branches. All repos must be on the same branch.\n${details}`);
    }
  }

  // Check branch doesn't exist in any source repo
  for (const s of sources) {
    const name = basename(s.path);
    if (branchExists(s.path, branch)) {
      errors.push(`Branch '${branch}' already exists in ${name}`);
    }
  }

  // Determine workspace ID
  const parentSource = sources.find(s => s.role === 'parent') || sources[0];
  const projectName = basename(parentSource.path);
  const workspaceId = toWorkspaceId(projectName, branch);

  // Check no existing active workspace with same ID
  const existing = await readWorkspaceState(workspaceId);
  if (existing && existing.status !== 'failed') {
    errors.push(`Workspace '${workspaceId}' already exists with status '${existing.status}'`);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Validate worktree base path is writable
  const worktreeBase = getWorktreeBasePath();
  const worktreeBaseError = validateWorktreeBasePath();
  if (worktreeBaseError) {
    errors.push(worktreeBaseError);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    sources: sourceRepos,
    workspaceId,
    worktreeBase,
  };
}
