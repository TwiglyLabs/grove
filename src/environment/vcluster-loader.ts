/**
 * Loader for the vCluster-based .grove.yaml config format.
 *
 * Detects whether a .grove.yaml uses the new vCluster format (by the presence
 * of the `platform` key) and parses it with the appropriate schema.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ZodError } from 'zod';
import type { RepoId } from '../shared/identity.js';
import { resolveRepoPath } from '../repo/api.js';
import { ConfigNotFoundError, ConfigValidationError } from '../shared/errors.js';
import {
  groveEnvironmentConfigSchema,
  isVClusterConfig,
  type GroveEnvironmentConfig,
} from './vcluster-config.js';

/**
 * Load a .grove.yaml as the new vCluster config format.
 *
 * Throws if the file doesn't exist, fails validation, or doesn't use the
 * new format (i.e. has no `platform` key).
 */
export async function loadVClusterConfig(repo: RepoId): Promise<GroveEnvironmentConfig> {
  const repoPath = await resolveRepoPath(repo);
  return loadVClusterConfigFromPath(repoPath);
}

/**
 * Load a .grove.yaml from a filesystem path as the vCluster config format.
 */
export function loadVClusterConfigFromPath(repoPath: string): GroveEnvironmentConfig {
  const configPath = join(repoPath, '.grove.yaml');

  if (!existsSync(configPath)) {
    throw new ConfigNotFoundError(repoPath);
  }

  const content = readFileSync(configPath, 'utf-8');
  const raw = parse(content);

  try {
    return groveEnvironmentConfigSchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigValidationError(error.issues);
    }
    throw error;
  }
}

/**
 * Check whether a .grove.yaml uses the new vCluster format.
 *
 * Returns false (rather than throwing) if the repo cannot be resolved or
 * the config file cannot be read. This allows legacy code paths to proceed
 * gracefully when running in test environments without a full repo setup.
 */
export async function isVClusterRepo(repo: RepoId): Promise<boolean> {
  try {
    const repoPath = await resolveRepoPath(repo);
    return isVClusterRepoPath(repoPath);
  } catch {
    return false;
  }
}

/**
 * Check whether the .grove.yaml at a path uses the new vCluster format.
 */
export function isVClusterRepoPath(repoPath: string): boolean {
  const configPath = join(repoPath, '.grove.yaml');

  if (!existsSync(configPath)) return false;

  try {
    const content = readFileSync(configPath, 'utf-8');
    const raw = parse(content);
    return isVClusterConfig(raw);
  } catch {
    return false;
  }
}
