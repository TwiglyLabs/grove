import { z } from 'zod';

export const RepoEntry = z.object({
  name: z.string(),
  path: z.string(),
  addedAt: z.string().datetime(),
});
export type RepoEntry = z.infer<typeof RepoEntry>;

export const RepoRegistry = z.object({
  version: z.literal(1),
  repos: z.array(RepoEntry),
});
export type RepoRegistry = z.infer<typeof RepoRegistry>;
