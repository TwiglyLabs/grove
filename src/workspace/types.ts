import { z } from 'zod';

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
