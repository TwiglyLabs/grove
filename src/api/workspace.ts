/**
 * Grove API: Workspace module
 *
 * Manages multi-repo workspaces backed by git worktrees.
 * All operations accept WorkspaceId. The CLI resolves branch names
 * to WorkspaceIds before calling these functions.
 */

import { existsSync } from 'fs';
import { createWorkspace as internalCreate, type CreateResult as InternalCreateResult } from '../workspace/create.js';
import { listWorkspaces as internalList } from '../workspace/status.js';
import { getWorkspaceStatus as internalGetStatus } from '../workspace/status.js';
import { syncWorkspace as internalSync, ConflictError as InternalConflictError } from '../workspace/sync.js';
import { closeWorkspace as internalClose } from '../workspace/close.js';
import {
  readWorkspaceState as internalReadState,
  findWorkspaceByBranch,
} from '../workspace/state.js';
import type { WorkspaceState } from '../workspace/types.js';
import type { RepoId, WorkspaceId } from '../shared/identity.js';
import { asWorkspaceId } from '../shared/identity.js';
import { resolveRepoPath } from './repo.js';
import { WorkspaceNotFoundError, ConflictError } from '../shared/errors.js';
import type {
  CreateOptions,
  CreateResult,
  ListOptions,
  WorkspaceListEntry,
  WorkspaceStatusResult,
  SyncOptions,
  SyncResult,
  CloseMode,
  CloseOptions,
  CloseResult,
  DryRunResult,
} from './types.js';
import type { WorkspaceEvents } from './events.js';

/**
 * Create a workspace with git worktrees for the parent repo and any child repos.
 */
export async function create(
  branch: string,
  options: CreateOptions,
  _events?: WorkspaceEvents,
): Promise<CreateResult> {
  const repoPath = await resolveRepoPath(options.from);

  const result = await internalCreate(branch, { from: repoPath });

  return {
    id: asWorkspaceId(result.id),
    root: result.root,
    branch: result.branch,
    repos: result.repos,
  };
}

/**
 * List all workspaces. Optionally filter by source repo.
 */
export async function list(options?: ListOptions): Promise<WorkspaceListEntry[]> {
  const items = internalList();

  let filtered = items;
  if (options?.repo) {
    const repoPath = await resolveRepoPath(options.repo);
    filtered = items.filter(ws => {
      // Match by checking if the workspace source path matches
      const state = internalReadState(ws.id);
      return state?.source === repoPath;
    });
  }

  return filtered.map(item => ({
    id: asWorkspaceId(item.id),
    branch: item.branch,
    status: item.status,
    age: item.age,
    root: item.root,
    missing: item.missing,
  }));
}

/**
 * Get detailed status for a workspace including per-repo dirty/commit counts.
 */
export function getStatus(workspace: WorkspaceId): WorkspaceStatusResult {
  const result = internalGetStatus(workspace);

  return {
    id: asWorkspaceId(result.id),
    status: result.status,
    branch: result.branch,
    repos: result.repos,
  };
}

/**
 * Sync a workspace — fetch and merge upstream into all repos.
 */
export async function sync(
  workspace: WorkspaceId,
  _options?: SyncOptions,
  _events?: WorkspaceEvents,
): Promise<SyncResult> {
  // Resolve workspace ID to branch for the internal function
  const state = resolveWorkspace(workspace);

  try {
    const result = await internalSync(state.branch);
    return {
      synced: result.synced,
      details: result.details.map(d => ({ name: d.name, status: d.status })),
    };
  } catch (error) {
    if (error instanceof InternalConflictError) {
      throw new ConflictError(error.conflicted, error.files);
    }
    throw error;
  }
}

/**
 * Close a workspace — merge commits to parent branch or discard all changes.
 */
export async function close(
  workspace: WorkspaceId,
  mode: CloseMode,
  options?: CloseOptions,
  _events?: WorkspaceEvents,
): Promise<CloseResult | DryRunResult> {
  const state = resolveWorkspace(workspace);

  const result = await internalClose(state.branch, mode, { dryRun: options?.dryRun });

  if (options?.dryRun && result) {
    return result as DryRunResult;
  }

  return {
    branch: state.branch,
    mode,
  };
}

/**
 * Resolve workspace root path for shell integration.
 */
export function resolvePath(workspace: WorkspaceId): string {
  const state = resolveWorkspace(workspace);
  return state.root;
}

/**
 * Direct state access for advanced use cases.
 */
export function readState(workspace: WorkspaceId): WorkspaceState | null {
  return internalReadState(workspace) ?? findWorkspaceByBranch(workspace) ?? null;
}

/** Resolve a WorkspaceId to a WorkspaceState, throwing if not found */
function resolveWorkspace(workspace: WorkspaceId): WorkspaceState {
  const state = internalReadState(workspace) ?? findWorkspaceByBranch(workspace);
  if (!state) {
    throw new WorkspaceNotFoundError(workspace);
  }
  return state;
}
