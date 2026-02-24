import { z } from 'zod';
import type { RepoId } from '../shared/identity.js';
import type { Logger } from '@twiglylabs/log';

export interface RepoAddOptions {
  logger?: Logger;
}

export interface RepoRemoveOptions {
  logger?: Logger;
}

export const RepoEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  addedAt: z.string().datetime(),
});

export interface RepoEntry {
  id: RepoId;
  name: string;
  path: string;
  addedAt: string;
}

/**
 * Schema for entries read from disk — id is optional for backwards compatibility.
 * The lazy migration in state.ts backfills missing IDs before returning.
 */
export const RepoEntryOnDisk = z.object({
  id: z.string().optional(),
  name: z.string(),
  path: z.string(),
  addedAt: z.string().datetime(),
});
export type RepoEntryOnDisk = z.infer<typeof RepoEntryOnDisk>;

export const RepoRegistry = z.object({
  version: z.literal(1),
  repos: z.array(RepoEntryOnDisk),
});
export type RepoRegistry = z.infer<typeof RepoRegistry>;

export interface RepoListEntry extends RepoEntry {
  exists: boolean;
  workspaceCount: number;
}
