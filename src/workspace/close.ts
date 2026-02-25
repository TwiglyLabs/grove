import { readWorkspaceState, writeWorkspaceState, findWorkspaceByBranch, deleteWorkspaceState } from './state.js';
import { hasDirtyWorkingTree, checkout, mergeFFOnly, merge, removeWorktree, deleteBranch, mergeAbort, getRepoStatus } from './git.js';
import { syncWorkspace, ConflictError } from './sync.js';
import type { WorkspaceState } from './types.js';
import type { Logger } from '@twiglylabs/log';

export interface CloseOptions {
  dryRun?: boolean;
  logger?: Logger;
}

export interface CloseDryRunResult {
  repos: Array<{
    name: string;
    role: string;
    commits: number;
  }>;
}

export async function closeWorkspace(
  branch: string,
  mode: 'merge' | 'discard',
  options: CloseOptions = {},
): Promise<CloseDryRunResult | void> {
  const state = await readWorkspaceState(branch) ?? await findWorkspaceByBranch(branch);
  if (!state) {
    throw new Error(`No workspace found for '${branch}'`);
  }

  if (mode === 'merge') {
    return await closeMerge(state, options);
  } else {
    await closeDiscard(state);
  }
}

async function closeMerge(state: WorkspaceState, options: CloseOptions = {}): Promise<CloseDryRunResult | void> {
  const { dryRun, logger } = options;

  if (state.status !== 'active' && state.status !== 'failed') {
    throw new Error(`Cannot merge-close workspace in '${state.status}' state. Use --discard instead.`);
  }

  // Check no dirty repos
  for (const repo of state.repos) {
    if (hasDirtyWorkingTree(repo.worktree)) {
      throw new Error(
        `Uncommitted changes in '${repo.name}'. Commit or stash before closing.`,
      );
    }
  }

  // If dry-run, return commit counts without syncing or closing
  if (dryRun) {
    const result: CloseDryRunResult = { repos: [] };
    for (const repo of state.repos) {
      const { commits } = getRepoStatus(repo.worktree, repo.parentBranch);
      result.repos.push({ name: repo.name, role: repo.role, commits });
    }
    return result;
  }

  // Sync workspace to ensure it has latest upstream changes.
  // Without this, if origin/parentBranch has advanced but the source repo's
  // local parentBranch hasn't been pulled, the FF merge could succeed but
  // leave the source repo missing upstream commits.
  await syncAndLog(state, logger);

  // Set status to closing
  state.status = 'closing';
  state.updatedAt = new Date().toISOString();
  await writeWorkspaceState(state);

  // Close in reverse order: children first, then parent
  const ordered = [...state.repos].sort((a, b) => {
    if (a.role === 'parent' && b.role !== 'parent') return 1;
    if (a.role !== 'parent' && b.role === 'parent') return -1;
    return 0;
  });

  for (const repo of ordered) {
    // Checkout parent branch in source
    checkout(repo.source, repo.parentBranch);

    // Fast-forward merge — retry once if it fails (handles race where
    // another close advanced parentBranch between sync and merge)
    if (!mergeFFOnly(repo.source, state.branch)) {
      logger?.info('ff-merge failed, re-merging and retrying', { repo: repo.name, branch: state.branch });

      // Targeted fix: merge latest parentBranch into this repo's worktree
      // so the workspace branch becomes a descendant of parentBranch again.
      // We can't call syncWorkspace here because status is 'closing' and
      // earlier repos' worktrees may already be removed.
      const remerge = merge(repo.worktree, repo.parentBranch);
      if (!remerge.ok) {
        state.status = 'failed';
        state.updatedAt = new Date().toISOString();
        await writeWorkspaceState(state);
        throw new Error(
          `Merge conflicts in '${repo.name}' during close retry. ` +
          `Workspace is partially closed — run 'grove workspace close ${state.branch} --discard' to clean up.`,
        );
      }

      checkout(repo.source, repo.parentBranch);

      if (!mergeFFOnly(repo.source, state.branch)) {
        state.status = 'failed';
        state.updatedAt = new Date().toISOString();
        await writeWorkspaceState(state);
        throw new Error(
          `Fast-forward merge failed for '${repo.name}' during close. ` +
          `Workspace is partially closed — run 'grove workspace close ${state.branch} --discard' to clean up.`,
        );
      }
    }

    logger?.debug('repo merged', { repo: repo.name, branch: state.branch });

    // Remove worktree and branch
    try {
      removeWorktree(repo.source, repo.worktree);
    } catch {
      // May already be gone
    }
    try {
      deleteBranch(repo.source, state.branch);
    } catch {
      // May already be gone
    }
  }

  await deleteWorkspaceState(state.id);
}

async function syncAndLog(state: WorkspaceState, logger?: Logger): Promise<void> {
  logger?.debug('syncing workspace', { branch: state.branch });
  try {
    await syncWorkspace(state.branch, logger);
  } catch (e) {
    if (e instanceof ConflictError) {
      throw new Error(
        `Cannot merge: conflicts in '${e.conflicted}'. ` +
        `Resolve conflicts, commit, then run 'grove workspace sync ${state.branch}' to complete syncing.`,
      );
    }
    throw e;
  }
}

async function closeDiscard(state: WorkspaceState): Promise<void> {
  // Set status to closing
  state.status = 'closing';
  state.updatedAt = new Date().toISOString();
  try {
    await writeWorkspaceState(state);
  } catch {
    // Best effort — state file may be corrupted
  }

  const warnings: string[] = [];

  // Process all repos — errors collected, not fatal
  for (const repo of [...state.repos].reverse()) {
    // Abort any active merge
    try {
      mergeAbort(repo.worktree);
    } catch {
      // Ignore — may not have active merge
    }

    // Force remove worktree
    try {
      removeWorktree(repo.source, repo.worktree, true);
    } catch (error) {
      warnings.push(`Failed to remove worktree for ${repo.name}: ${error}`);
    }

    // Force delete branch
    try {
      deleteBranch(repo.source, state.branch, true);
    } catch (error) {
      warnings.push(`Failed to delete branch for ${repo.name}: ${error}`);
    }
  }

  await deleteWorkspaceState(state.id);

  if (warnings.length > 0) {
    console.warn('Warnings during discard:\n' + warnings.map(w => `  - ${w}`).join('\n'));
  }
}
