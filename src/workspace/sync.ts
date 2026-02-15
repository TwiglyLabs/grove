import { readWorkspaceState, writeWorkspaceState, findWorkspaceByBranch } from './state.js';
import { fetch, merge, isMergeInProgress, hasDirtyWorkingTree } from './git.js';
import type { WorkspaceState } from './types.js';

export interface SyncRepoDetail {
  name: string;
  status: 'synced' | 'skipped';
}

export interface SyncResult {
  synced: string[];
  details: SyncRepoDetail[];
}

export async function syncWorkspace(branch: string): Promise<SyncResult> {
  const state = readWorkspaceState(branch) ?? findWorkspaceByBranch(branch);
  if (!state) {
    throw new Error(`No workspace found for '${branch}'`);
  }

  if (state.status !== 'active' && state.status !== 'failed') {
    throw new Error(`Workspace '${state.id}' is in '${state.status}' state, expected 'active' or 'failed'`);
  }

  // If failed, reset to active before proceeding
  if (state.status === 'failed') {
    state.status = 'active';
    state.updatedAt = new Date().toISOString();
    await writeWorkspaceState(state);
  }

  // Initialize sync progress if not present
  if (!state.sync) {
    state.sync = {
      startedAt: new Date().toISOString(),
      repos: Object.fromEntries(state.repos.map(r => [r.name, 'pending' as const])),
    };
    await writeWorkspaceState(state);
  }

  const synced: string[] = [];
  const details: SyncRepoDetail[] = [];

  // Process repos in order: parent first, then children
  const ordered = [...state.repos].sort((a, b) => {
    if (a.role === 'parent' && b.role !== 'parent') return -1;
    if (a.role !== 'parent' && b.role === 'parent') return 1;
    return 0;
  });

  for (const repo of ordered) {
    const repoSyncStatus = state.sync.repos[repo.name];

    if (repoSyncStatus === 'synced') {
      synced.push(repo.name);
      details.push({ name: repo.name, status: 'skipped' });
      continue;
    }

    if (repoSyncStatus === 'conflicted') {
      // Check if conflicts have been resolved
      if (isMergeInProgress(repo.worktree)) {
        throw new ConflictError(
          `Merge still in progress in '${repo.name}'. Resolve conflicts and commit.`,
          repo.name,
          [],
          synced,
          ordered.filter(r => state.sync!.repos[r.name] === 'pending').map(r => r.name),
        );
      }

      if (hasDirtyWorkingTree(repo.worktree)) {
        throw new ConflictError(
          `Uncommitted changes in '${repo.name}'. Commit your conflict resolution before syncing.`,
          repo.name,
          [],
          synced,
          ordered.filter(r => state.sync!.repos[r.name] === 'pending').map(r => r.name),
        );
      }

      // Conflicts resolved and committed — mark as synced
      state.sync.repos[repo.name] = 'synced';
      await writeWorkspaceState(state);
      synced.push(repo.name);
      details.push({ name: repo.name, status: 'synced' });
      continue;
    }

    // Status is 'pending' — fetch and merge
    fetch(repo.worktree);
    const mergeResult = merge(repo.worktree, `origin/${repo.parentBranch}`);

    if (mergeResult.ok) {
      state.sync.repos[repo.name] = 'synced';
      await writeWorkspaceState(state);
      synced.push(repo.name);
      details.push({ name: repo.name, status: 'synced' });
    } else {
      state.sync.repos[repo.name] = 'conflicted';
      await writeWorkspaceState(state);

      const pending = ordered
        .filter(r => state.sync!.repos[r.name] === 'pending')
        .map(r => r.name);

      throw new ConflictError(
        `Merge conflicts in ${repo.name}`,
        repo.name,
        mergeResult.conflicts,
        synced,
        pending,
      );
    }
  }

  // All synced — clear sync state
  state.sync = null;
  state.updatedAt = new Date().toISOString();
  await writeWorkspaceState(state);

  return { synced, details };
}

export class ConflictError extends Error {
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
