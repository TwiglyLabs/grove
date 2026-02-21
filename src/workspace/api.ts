/**
 * Workspace slice — public API
 *
 * Manages multi-repo workspaces backed by git worktrees.
 * All operations accept WorkspaceId. The CLI resolves branch names
 * to WorkspaceIds before calling these functions.
 */

import { createWorkspace as internalCreate, type CreateResult as InternalCreateResult } from './create.js';
import { listWorkspaces as internalList } from './status.js';
import { getWorkspaceStatus as internalGetStatus } from './status.js';
import { syncWorkspace as internalSync, ConflictError as InternalConflictError } from './sync.js';
import { closeWorkspace as internalClose } from './close.js';
import {
  readWorkspaceState as internalReadState,
  findWorkspaceByBranch,
  deleteWorkspaceState as internalDeleteState,
} from './state.js';
import type { WorkspaceState } from './types.js';
import type { RepoId, WorkspaceId } from '../shared/identity.js';
import { asWorkspaceId } from '../shared/identity.js';
import { resolveRepoPath } from '../repo/api.js';
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
  WorkspaceEvents,
  EnvironmentDescriptor,
} from './types.js';
import { loadConfig } from '../config.js';
import { readState as readEnvState } from '../environment/state.js';
import { sanitizeBranchName } from './sanitize.js';

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
    setup: result.setup,
    hookResult: result.hookResult,
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

/**
 * Find orphaned worktrees — workspace states whose root directory no longer exists.
 * Used by environment prune to clean up stale workspace state.
 */
export function findOrphanedWorktrees(): Array<{ path: string; workspaceId: string }> {
  const states = internalList();
  const orphaned: Array<{ path: string; workspaceId: string }> = [];

  for (const ws of states) {
    if (ws.missing) {
      orphaned.push({
        path: ws.root,
        workspaceId: ws.id,
      });
    }
  }

  return orphaned;
}

/**
 * Clean up orphaned workspace states by deleting their state files.
 */
export function cleanOrphanedWorktrees(entries: Array<{ workspaceId: string }>): void {
  for (const entry of entries) {
    try {
      internalDeleteState(entry.workspaceId);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Describe a workspace environment — compose workspace state, environment state,
 * and config into a single EnvironmentDescriptor for handoff to agents.
 */
export function describe(workspace: WorkspaceId): EnvironmentDescriptor {
  const state = resolveWorkspace(workspace);
  const config = loadConfig(state.source);
  const worktreeId = sanitizeBranchName(state.branch);
  const envState = readEnvState(config, worktreeId);

  // Workspace info from state
  const workspaceInfo: EnvironmentDescriptor['workspace'] = {
    id: asWorkspaceId(state.id),
    branch: state.branch,
    repos: state.repos.map(r => ({
      name: r.name,
      path: r.worktree,
      role: r.role,
    })),
  };

  // Services from environment state ports/URLs + config service definitions
  const services: EnvironmentDescriptor['services'] = config.services
    .filter(s => s.portForward)
    .map(s => ({
      name: s.name,
      url: envState?.urls[s.name] ?? '',
      port: envState?.ports[s.name] ?? 0,
    }));

  // Frontends from config + environment state
  const frontends: EnvironmentDescriptor['frontends'] = (config.frontends ?? []).map(f => ({
    name: f.name,
    url: envState?.urls[f.name] ?? '',
    cwd: f.cwd,
  }));

  // Testing commands from config — extract runner per platform
  const commands: Record<string, string> = {};
  if (config.testing) {
    if (config.testing.mobile) commands.mobile = config.testing.mobile.runner;
    if (config.testing.webapp) commands.webapp = config.testing.webapp.runner;
    if (config.testing.api) commands.api = config.testing.api.runner;
  }

  // Shell targets from config utilities
  const targets = (config.utilities?.shellTargets ?? []).map(t => t.name);

  return {
    workspace: workspaceInfo,
    services,
    frontends,
    testing: { commands },
    shell: { targets },
  };
}

/** Resolve a WorkspaceId to a WorkspaceState, throwing if not found */
function resolveWorkspace(workspace: WorkspaceId): WorkspaceState {
  const state = internalReadState(workspace) ?? findWorkspaceByBranch(workspace);
  if (!state) {
    throw new WorkspaceNotFoundError(workspace);
  }
  return state;
}
