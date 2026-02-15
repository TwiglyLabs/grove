/**
 * Branded identity types for repos and workspaces.
 *
 * RepoId and WorkspaceId are opaque strings — consumers should not parse
 * or construct them directly. IDs are assigned by grove on creation and
 * discoverable via list operations.
 */

import { nanoid } from 'nanoid';

export type RepoId = string & { readonly __brand: 'RepoId' };
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

/** Generate a new RepoId (internal use — called during repo.add and lazy migration) */
export function createRepoId(): RepoId {
  return `repo_${nanoid(12)}` as RepoId;
}

/** Check if a string is a valid RepoId format */
export function isRepoId(value: string): value is RepoId {
  return value.startsWith('repo_');
}

/** Cast a string to RepoId, throwing if the format is invalid */
export function asRepoId(value: string): RepoId {
  if (!isRepoId(value)) {
    throw new Error(`Invalid RepoId: ${value}`);
  }
  return value;
}

/** Cast a string to WorkspaceId (workspace IDs have no fixed prefix) */
export function asWorkspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}
