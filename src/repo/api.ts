/**
 * Repo slice — public API
 *
 * Manages the global repo registry. The registry is the source of truth
 * for RepoId → path mapping. All API functions that reference repos
 * accept RepoId — the CLI resolves paths to IDs via findByPath().
 */

import { access, realpath } from 'fs/promises';
import {
  readRegistry,
  addRepo as internalAddRepo,
  removeRepo as internalRemoveRepo,
} from './state.js';
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
  const workspaces = await listWorkspaceStates();

  const sorted = registry.repos
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return Promise.all(
    sorted.map(async entry => {
      const matching = workspaces.filter(ws => ws.source === entry.path);
      const exists = await access(entry.path).then(() => true, () => false);
      return {
        id: asRepoId(entry.id!),
        name: entry.name,
        path: entry.path,
        addedAt: entry.addedAt,
        exists,
        workspaceCount: matching.length,
      };
    }),
  );
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
    resolvedPath = await realpath(path);
  } catch {
    resolvedPath = path;
  }

  for (const r of registry.repos) {
    let rResolved: string;
    try {
      rResolved = await realpath(r.path);
    } catch {
      rResolved = r.path;
    }

    if (rResolved === resolvedPath) {
      if (!r.id) return null;
      return {
        id: asRepoId(r.id),
        name: r.name,
        path: r.path,
        addedAt: r.addedAt,
      };
    }
  }

  return null;
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
