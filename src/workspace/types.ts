import { z } from 'zod';
import type { RepoId, WorkspaceId } from '../shared/identity.js';
import type { GroveError } from '../shared/errors.js';

// --- Zod schemas for persisted state ---

export const SyncStatus = z.enum(['pending', 'synced', 'conflicted']);
export type SyncStatus = z.infer<typeof SyncStatus>;

export const WorkspaceRepoState = z.object({
  name: z.string(),
  role: z.enum(['parent', 'child']),
  source: z.string(),
  worktree: z.string(),
  parentBranch: z.string(),
});
export type WorkspaceRepoState = z.infer<typeof WorkspaceRepoState>;

export const SyncState = z.object({
  startedAt: z.string().datetime(),
  repos: z.record(SyncStatus),
}).nullable();
export type SyncState = z.infer<typeof SyncState>;

export const WorkspaceStatus = z.enum(['creating', 'active', 'closing', 'failed']);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatus>;

export const WorkspaceState = z.object({
  version: z.literal(1),
  id: z.string(),
  status: WorkspaceStatus,
  branch: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  root: z.string(),
  source: z.string(),
  repos: z.array(WorkspaceRepoState),
  sync: SyncState,
});
export type WorkspaceState = z.infer<typeof WorkspaceState>;

// --- Public API types ---

export interface CreateOptions {
  from: RepoId;
  signal?: AbortSignal;
}

export interface CreateResult {
  id: WorkspaceId;
  root: string;
  branch: string;
  repos: string[];
}

export interface ListOptions {
  repo?: RepoId;
}

export interface WorkspaceListEntry {
  id: WorkspaceId;
  branch: string;
  status: string;
  age: string;
  root: string;
  missing: boolean;
}

export interface WorkspaceStatusResult {
  id: WorkspaceId;
  status: string;
  branch: string;
  repos: Array<{
    name: string;
    role: 'parent' | 'child';
    dirty: number;
    commits: number;
    syncStatus: string | null;
  }>;
}

export interface SyncOptions {
  signal?: AbortSignal;
}

export interface SyncResult {
  synced: string[];
  details: Array<{ name: string; status: string }>;
}

export type CloseMode = 'merge' | 'discard';

export interface CloseOptions {
  dryRun?: boolean;
  signal?: AbortSignal;
}

export interface DryRunResult {
  repos: Array<{ name: string; commits: number }>;
}

export interface CloseResult {
  branch: string;
  mode: CloseMode;
}

// --- Event interface ---

export interface WorkspaceEvents {
  onProgress?(step: string, repo?: string, detail?: string): void;
  onConflict?(repo: string, files: string[]): void;
  onError?(error: GroveError): void;
}
