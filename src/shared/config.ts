/**
 * Grove API: Config module
 *
 * Load and validate .grove.yaml for a registered repo.
 * All functions accept RepoId — no raw paths.
 */

import type { RepoId } from './identity.js';
import { resolveRepoPath } from '../api/repo.js';
import {
  loadConfig as internalLoadConfig,
  loadWorkspaceConfig as internalLoadWorkspaceConfig,
  type GroveConfig,
  type WorkspaceConfig,
} from '../config.js';
import { ConfigNotFoundError, ConfigValidationError } from './errors.js';
import { ZodError } from 'zod';

/**
 * Load and validate .grove.yaml for a registered repo.
 * Resolves the repo's filesystem path from the registry internally.
 */
export async function load(repo: RepoId): Promise<GroveConfig> {
  const repoPath = await resolveRepoPath(repo);
  try {
    return internalLoadConfig(repoPath);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigValidationError(error.issues);
    }
    if (error instanceof Error && error.message.includes('Config file not found')) {
      throw new ConfigNotFoundError(repoPath);
    }
    throw error;
  }
}

/**
 * Load just the workspace section from .grove.yaml.
 * Returns null if the file is missing or has no workspace section.
 */
export async function loadWorkspaceConfig(repo: RepoId): Promise<WorkspaceConfig | null> {
  const repoPath = await resolveRepoPath(repo);
  return internalLoadWorkspaceConfig(repoPath);
}
