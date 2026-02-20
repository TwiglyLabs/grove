/**
 * Grove API: Repo module
 *
 * Manages the global repo registry. The registry is the source of truth
 * for RepoId → path mapping. All API functions that reference repos
 * accept RepoId — the CLI resolves paths to IDs via findByPath().
 */

import { existsSync, realpathSync } from 'fs';
import {
  readRegistry,
  addRepo as internalAddRepo,
  removeRepo as internalRemoveRepo,
} from '../repo/state.js';
import { listWorkspaceStates } from '../workspace/state.js';
import type { RepoId } from '../shared/identity.js';
import { asRepoId } from '../shared/identity.js';
import { RepoNotFoundError } from '../shared/errors.js';
import type { RepoEntry, RepoListEntry } from './types.js';

/**
 * Register a repo by its filesystem path.
 * Returns the created entry with a newly assigned RepoId.
 * If the path is already registered, returns the existing entry.
 */
export async function add(path: string): Promise<RepoEntry> {
  const { name, path: registeredPath, alreadyRegistered } = await internalAddRepo(
    pathToName(path),
    path,
  );

  // Re-read to get the entry with its ID
  const registry = await readRegistry();
  const entry = registry.repos.find(r => r.path === registeredPath);
  if (!entry || !entry.id) {
    throw new Error('Failed to retrieve registered repo entry');
  }

  return {
    id: asRepoId(entry.id),
    name: entry.name,
    path: entry.path,
    addedAt: entry.addedAt,
  };
}

/**
 * Unregister a repo by its ID.
 */
export async function remove(repo: RepoId): Promise<void> {
  const entry = await get(repo);
  if (!entry) {
    throw new RepoNotFoundError(repo);
  }
  await internalRemoveRepo(entry.name);
}

/**
 * Look up a single repo by ID. Returns null if not found.
 */
export async function get(repo: RepoId): Promise<RepoEntry | null> {
  const registry = await readRegistry();
  const entry = registry.repos.find(r => r.id === repo);
  if (!entry || !entry.id) return null;

  return {
    id: asRepoId(entry.id),
    name: entry.name,
    path: entry.path,
    addedAt: entry.addedAt,
  };
}

/**
 * List all registered repos with workspace counts and existence checks.
 */
export async function list(): Promise<RepoListEntry[]> {
  const registry = await readRegistry();
  const workspaces = listWorkspaceStates();

  return registry.repos
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => {
      const matching = workspaces.filter(ws => ws.source === entry.path);
      return {
        id: asRepoId(entry.id!),
        name: entry.name,
        path: entry.path,
        addedAt: entry.addedAt,
        exists: existsSync(entry.path),
        workspaceCount: matching.length,
      };
    });
}

/**
 * Resolve a filesystem path to a RepoEntry.
 * The CLI calls this to resolve cwd to a RepoId before calling other API functions.
 * Returns null if the path isn't registered.
 */
export async function findByPath(path: string): Promise<RepoEntry | null> {
  const registry = await readRegistry();
  let resolvedPath: string;
  try {
    resolvedPath = realpathSync(path);
  } catch {
    resolvedPath = path;
  }

  const entry = registry.repos.find(r => {
    try {
      return realpathSync(r.path) === resolvedPath;
    } catch {
      return r.path === resolvedPath;
    }
  });

  if (!entry || !entry.id) return null;

  return {
    id: asRepoId(entry.id),
    name: entry.name,
    path: entry.path,
    addedAt: entry.addedAt,
  };
}

/**
 * Resolve a RepoId to its filesystem path.
 * Throws RepoNotFoundError if the ID isn't in the registry.
 */
export async function resolveRepoPath(repo: RepoId): Promise<string> {
  const entry = await get(repo);
  if (!entry) {
    throw new RepoNotFoundError(repo);
  }
  return entry.path;
}

/** Extract repo name from path (basename) */
function pathToName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}
