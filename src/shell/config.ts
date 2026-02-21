/**
 * Shell slice config schemas.
 *
 * Owns: shell targets zod schema (from former UtilitiesSchema).
 * These are composed into the root GroveConfigSchema.
 */

import { z } from 'zod';

export const ShellTargetSchema = z.object({
  name: z.string(),
  podSelector: z.string().optional(),
  shell: z.string().optional(),
});

export const ShellTargetsSchema = z.array(ShellTargetSchema).optional();

// --- Derived types ---

export type ShellTarget = z.infer<typeof ShellTargetSchema>;
