import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

export const WorkspaceRepoSchema = z.object({
  path: z.string().min(1),
  remote: z.string().optional(),
});

export const WorkspaceConfigSchema = z.object({
  repos: z.array(WorkspaceRepoSchema).min(1),
});

export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

// Partial schema for workspace-only parsing (doesn't require project/helm/services)
const PartialGroveConfigSchema = z.object({
  workspace: WorkspaceConfigSchema.optional(),
}).passthrough();

/**
 * Load workspace config from .grove.yaml. Returns null if file is missing
 * or has no workspace section. Does NOT throw for missing config.
 */
export function loadWorkspaceConfig(repoRoot: string): WorkspaceConfig | null {
  const configPath = join(repoRoot, '.grove.yaml');
  if (!existsSync(configPath)) return null;

  try {
    const raw = parse(readFileSync(configPath, 'utf-8'));
    const parsed = PartialGroveConfigSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data.workspace ?? null;
  } catch {
    return null;
  }
}
