import { join, basename, resolve } from 'path';
import { execSync } from 'child_process';
import { loadWorkspaceConfig } from './config.js';
import { preflightCreate, validateRepoPaths } from './preflight.js';
import { createWorktree, removeWorktree, deleteBranch, getWorktreeBasePath } from './git.js';
import { writeWorkspaceState, readWorkspaceState, deleteWorkspaceState } from './state.js';
import { runSetupCommands, runHook } from './setup.js';
import type { WorkspaceState, WorkspaceRepoState, SetupResult } from './types.js';

export interface CreateResult {
  id: string;
  root: string;
  repos: string[];
  branch: string;
  setup?: SetupResult[];
  hookResult?: SetupResult;
}

function getRepoRoot(fromPath?: string): string {
  const cwd = fromPath || process.cwd();
  return execSync('git rev-parse --show-toplevel', { cwd, encoding: 'utf-8' }).trim();
}

export async function createWorkspace(
  branch: string,
  options: { from?: string; childRepos?: Array<{ path: string; name: string }> } = {},
): Promise<CreateResult> {
  const sourceRoot = resolve(getRepoRoot(options.from));
  const projectName = basename(sourceRoot);

  // Check for failed state and clean up
  const workspaceId = `${projectName}-${branch}`;
  const existingState = readWorkspaceState(workspaceId);
  if (existingState?.status === 'failed') {
    await cleanupFailed(existingState);
  }

  // Load workspace config (may be null for simple workspace)
  const workspaceConfig = loadWorkspaceConfig(sourceRoot);

  // Build source list
  const sources: Array<{ path: string; role: 'parent' | 'child'; name?: string }> = [
    { path: sourceRoot, role: 'parent' },
  ];

  if (options.childRepos !== undefined) {
    // API-provided repos — already resolved to absolute paths
    for (const repo of options.childRepos) {
      sources.push({ path: repo.path, role: 'child', name: repo.name });
    }
  } else if (workspaceConfig?.repos) {
    // Config-provided repos — resolve relative to parent root
    const pathErrors = validateRepoPaths(workspaceConfig.repos.map(r => r.path));
    if (pathErrors.length > 0) {
      throw new Error(pathErrors.join('\n'));
    }

    for (const repo of workspaceConfig.repos) {
      sources.push({
        path: resolve(sourceRoot, repo.path),
        role: 'child',
        name: repo.path,
      });
    }
  }

  // Run preflight
  const preflight = preflightCreate(sources, branch);
  if (!preflight.ok) {
    throw new Error(preflight.errors.join('\n'));
  }

  const worktreeRoot = join(preflight.worktreeBase, projectName, branch);

  // Write state as "creating"
  const repos: WorkspaceRepoState[] = preflight.sources.map(s => ({
    name: s.name,
    role: s.role,
    source: s.source,
    worktree: s.role === 'parent'
      ? worktreeRoot
      : join(worktreeRoot, s.name),
    parentBranch: s.parentBranch,
  }));

  const now = new Date().toISOString();
  const state: WorkspaceState = {
    version: 1,
    id: preflight.workspaceId,
    status: 'creating',
    branch,
    createdAt: now,
    updatedAt: now,
    root: worktreeRoot,
    source: sourceRoot,
    repos,
    sync: null,
  };

  await writeWorkspaceState(state);

  // Create worktrees (parent first, then children)
  const created: Array<{ source: string; worktree: string; branch: string }> = [];
  try {
    for (const repo of repos) {
      createWorktree(repo.source, branch, repo.worktree);
      created.push({ source: repo.source, worktree: repo.worktree, branch });
    }

    // Update state to active
    state.status = 'active';
    state.updatedAt = new Date().toISOString();
    await writeWorkspaceState(state);
  } catch (error) {
    // Rollback: remove all created worktrees and branches
    await rollback(created, state);
    throw error;
  }

  // Run setup commands for each repo worktree
  let allSetupResults: SetupResult[] | undefined;
  let hookResult: SetupResult | undefined;

  if (workspaceConfig?.setup && workspaceConfig.setup.length > 0) {
    const setupResults: SetupResult[] = [];
    let setupFailed = false;

    for (const repo of repos) {
      const results = runSetupCommands(workspaceConfig.setup, repo.worktree);
      setupResults.push(...results);

      const failedResult = results.find(r => r.exitCode !== 0);
      if (failedResult) {
        setupFailed = true;
        break;
      }
    }

    allSetupResults = setupResults;

    if (setupFailed) {
      state.status = 'failed';
      state.updatedAt = new Date().toISOString();
      await writeWorkspaceState(state);

      return {
        id: preflight.workspaceId,
        root: worktreeRoot,
        repos: repos.map(r => r.name),
        branch,
        setup: allSetupResults,
      };
    }
  }

  // Run postCreate hook
  if (workspaceConfig?.hooks?.postCreate) {
    hookResult = runHook(workspaceConfig.hooks.postCreate, worktreeRoot);

    if (hookResult.exitCode !== 0) {
      state.status = 'failed';
      state.updatedAt = new Date().toISOString();
      await writeWorkspaceState(state);
    }
  }

  return {
    id: preflight.workspaceId,
    root: worktreeRoot,
    repos: repos.map(r => r.name),
    branch,
    setup: allSetupResults,
    hookResult,
  };
}

async function rollback(
  created: Array<{ source: string; worktree: string; branch: string }>,
  state: WorkspaceState,
): Promise<void> {
  const warnings: string[] = [];

  // Remove in reverse order
  for (const entry of created.reverse()) {
    try {
      removeWorktree(entry.source, entry.worktree, true);
    } catch (error) {
      warnings.push(`Failed to remove worktree ${entry.worktree}: ${error}`);
    }
    try {
      deleteBranch(entry.source, entry.branch, true);
    } catch (error) {
      warnings.push(`Failed to delete branch ${entry.branch} in ${entry.source}: ${error}`);
    }
  }

  state.status = 'failed';
  state.updatedAt = new Date().toISOString();
  await writeWorkspaceState(state);

  if (warnings.length > 0) {
    console.warn('Warnings during rollback:\n' + warnings.map(w => `  - ${w}`).join('\n'));
  }
}

async function cleanupFailed(state: WorkspaceState): Promise<void> {
  for (const repo of [...state.repos].reverse()) {
    try {
      removeWorktree(repo.source, repo.worktree, true);
    } catch {
      // Ignore — may already be gone
    }
    try {
      deleteBranch(repo.source, state.branch, true);
    } catch {
      // Ignore — may already be gone
    }
  }
  deleteWorkspaceState(state.id);
}
