/**
 * Workspace slice — public API
 *
 * Manages multi-repo workspaces backed by git worktrees.
 * All operations accept WorkspaceId. The CLI resolves branch names
 * to WorkspaceIds before calling these functions.
 */

import { basename, resolve } from 'path';
import { realpath } from 'fs/promises';
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
import { asWorkspaceId, isRepoId } from '../shared/identity.js';
import { resolveRepoPath, get as getRepo } from '../repo/api.js';
import { WorkspaceNotFoundError, ConflictError, RepoNotFoundError } from '../shared/errors.js';
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
  RepoRef,
  RepoSpec,
} from './types.js';
import { loadConfig } from '../config.js';
import { readState as readEnvState } from '../environment/state.js';
import { sanitizeBranchName } from './sanitize.js';
import { noopLogger } from '@twiglylabs/log';

/**
 * Create a workspace with git worktrees for the parent repo and any child repos.
 */
export async function create(
  branch: string,
  options: CreateOptions,
  _events?: WorkspaceEvents,
): Promise<CreateResult> {
  const log = (options.logger ?? noopLogger).child('grove:workspace');
  const repoPath = await resolveRepoPath(options.from);

  // Resolve repo refs if provided (repos: [] means "no children, override config")
  let childRepos: Array<{ path: string; name: string }> | undefined;
  if (options.repos !== undefined) {
    childRepos = options.repos.length > 0
      ? await resolveRepoRefs(options.repos, repoPath)
      : [];
  }

  log.info('creating workspace', { branch, from: repoPath });

  const result = await internalCreate(branch, {
    from: repoPath,
    ...(childRepos !== undefined ? { childRepos } : {}),
  });

  log.info('workspace created', { id: result.id, branch: result.branch, repos: result.repos });

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
  const items = await internalList();

  let filtered = items;
  if (options?.repo) {
    const repoPath = await resolveRepoPath(options.repo);
    const filterResults = await Promise.all(
      items.map(async ws => {
        const state = await internalReadState(ws.id);
        return { ws, matches: state?.source === repoPath };
      }),
    );
    filtered = filterResults.filter(r => r.matches).map(r => r.ws);
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
export async function getStatus(workspace: WorkspaceId): Promise<WorkspaceStatusResult> {
  const result = await internalGetStatus(workspace);

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
  options?: SyncOptions,
  _events?: WorkspaceEvents,
): Promise<SyncResult> {
  const log = (options?.logger ?? noopLogger).child('grove:workspace');

  // Resolve workspace ID to branch for the internal function
  const state = await resolveWorkspace(workspace);

  log.info('syncing workspace', { workspace, branch: state.branch });

  try {
    const result = await internalSync(state.branch, log);
    log.info('workspace synced', { workspace, synced: result.synced });
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
  const log = (options?.logger ?? noopLogger).child('grove:workspace');
  const state = await resolveWorkspace(workspace);

  log.info('closing workspace', { workspace, branch: state.branch, mode });

  const result = await internalClose(state.branch, mode, { dryRun: options?.dryRun, logger: log });

  if (options?.dryRun && result) {
    return result as DryRunResult;
  }

  log.info('workspace closed', { workspace, branch: state.branch, mode });

  return {
    branch: state.branch,
    mode,
  };
}

/**
 * Resolve workspace root path for shell integration.
 */
export async function resolvePath(workspace: WorkspaceId): Promise<string> {
  const state = await resolveWorkspace(workspace);
  return state.root;
}

/**
 * Direct state access for advanced use cases.
 */
export async function readState(workspace: WorkspaceId): Promise<WorkspaceState | null> {
  return await internalReadState(workspace) ?? await findWorkspaceByBranch(workspace) ?? null;
}

/**
 * Find orphaned worktrees — workspace states whose root directory no longer exists.
 * Used by environment prune to clean up stale workspace state.
 */
export async function findOrphanedWorktrees(): Promise<Array<{ path: string; workspaceId: string }>> {
  const states = await internalList();
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
export async function cleanOrphanedWorktrees(entries: Array<{ workspaceId: string }>): Promise<void> {
  for (const entry of entries) {
    try {
      await internalDeleteState(entry.workspaceId);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Describe a workspace environment — compose workspace state, environment state,
 * and config into a single EnvironmentDescriptor for handoff to agents.
 */
export async function describe(workspace: WorkspaceId): Promise<EnvironmentDescriptor> {
  const state = await resolveWorkspace(workspace);
  const config = loadConfig(state.source);
  const worktreeId = sanitizeBranchName(state.branch);
  const envState = await readEnvState(config, worktreeId);

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

/** Resolve RepoRef[] to absolute paths and names */
async function resolveRepoRefs(
  refs: RepoRef[],
  parentPath: string,
): Promise<Array<{ path: string; name: string }>> {
  const resolved: Array<{ path: string; name: string }> = [];
  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();
  const parentReal = await realpath(parentPath);

  for (const ref of refs) {
    let refPath: string;
    let name: string;

    if (typeof ref === 'string' && isRepoId(ref)) {
      // RepoId — resolve via registry
      refPath = await resolveRepoPath(ref);
      const entry = await getRepo(ref);
      if (!entry) throw new RepoNotFoundError(ref);
      name = entry.name;
    } else {
      const spec = ref as RepoSpec;
      if (spec.path.startsWith('/') || /^[A-Za-z]:/.test(spec.path)) {
        // Absolute path
        refPath = spec.path;
        name = spec.name ?? basename(spec.path);
      } else {
        // Relative path — resolve against parent repo root
        refPath = resolve(parentPath, spec.path);
        name = spec.name ?? spec.path;
      }
    }

    // Deduplicate: skip if same as parent
    const realPath = await realpath(refPath);
    if (realPath === parentReal) continue;

    // Validate uniqueness
    if (seenPaths.has(realPath)) {
      throw new Error(`Duplicate repo path: ${refPath}`);
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate repo name '${name}' — use the 'name' field to disambiguate`);
    }

    seenPaths.add(realPath);
    seenNames.add(name);
    resolved.push({ path: realPath, name });
  }

  return resolved;
}

/** Resolve a WorkspaceId to a WorkspaceState, throwing if not found */
async function resolveWorkspace(workspace: WorkspaceId): Promise<WorkspaceState> {
  const state = await internalReadState(workspace) ?? await findWorkspaceByBranch(workspace);
  if (!state) {
    throw new WorkspaceNotFoundError(workspace);
  }
  return state;
}
