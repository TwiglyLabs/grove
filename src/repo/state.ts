import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import * as lockfile from 'proper-lockfile';
import { RepoRegistry, type RepoEntryOnDisk } from './types.js';
import { createRepoId } from '../shared/identity.js';

const LOCK_OPTIONS = { retries: { retries: 60, minTimeout: 10, maxTimeout: 100, randomize: true } };

export function getRegistryDir(): string {
  return process.env.GROVE_REGISTRY_DIR || join(homedir(), '.grove');
}

async function ensureRegistryDir(): Promise<string> {
  const dir = getRegistryDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function registryFilePath(): string {
  return join(getRegistryDir(), 'repos.json');
}

function emptyRegistry(): RepoRegistry {
  return { version: 1, repos: [] };
}

async function readRegistryFromDisk(): Promise<RepoRegistry> {
  const filePath = registryFilePath();

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = RepoRegistry.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

async function withRegistryLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const filePath = registryFilePath();
  await ensureRegistryDir();

  // Ensure file exists for proper-lockfile
  try {
    await writeFile(filePath, '{}', { flag: 'wx' });
  } catch {
    // File already exists — expected
  }

  const release = await lockfile.lock(filePath, LOCK_OPTIONS);
  try {
    return await fn();
  } finally {
    await release();
  }
}

/**
 * Read the repo registry, lazily migrating entries that lack an `id` field.
 * When missing IDs are found, they are generated and written back atomically.
 */
export async function readRegistry(): Promise<RepoRegistry> {
  const registry = await readRegistryFromDisk();

  if (registry.repos.length === 0) return registry;

  // Check if any entries are missing IDs
  const needsMigration = registry.repos.some(entry => !entry.id);
  if (!needsMigration) return registry;

  // Backfill IDs under lock to avoid overwriting concurrent changes
  return withRegistryLock(async () => {
    const fresh = await readRegistryFromDisk();
    for (const entry of fresh.repos) {
      if (!entry.id) {
        entry.id = createRepoId();
      }
    }
    await writeFile(registryFilePath(), JSON.stringify(fresh, null, 2), 'utf-8');
    return fresh;
  });
}

export interface AddResult {
  name: string;
  path: string;
  alreadyRegistered: boolean;
}

export async function addRepo(name: string, path: string): Promise<AddResult> {
  return withRegistryLock(async () => {
    const registry = await readRegistryFromDisk();

    // Backfill IDs if needed
    for (const entry of registry.repos) {
      if (!entry.id) {
        entry.id = createRepoId();
      }
    }

    // Check for duplicate path (no-op)
    const existingByPath = registry.repos.find(r => r.path === path);
    if (existingByPath) {
      return { name: existingByPath.name, path: existingByPath.path, alreadyRegistered: true };
    }

    // Check for name collision (different path, same name)
    const existingByName = registry.repos.find(r => r.name === name);
    if (existingByName) {
      throw new Error(
        `Name '${name}' is already registered for a different path: ${existingByName.path}`,
      );
    }

    const entry: RepoEntryOnDisk = {
      id: createRepoId(),
      name,
      path,
      addedAt: new Date().toISOString(),
    };

    registry.repos.push(entry);
    await writeFile(registryFilePath(), JSON.stringify(registry, null, 2), 'utf-8');

    return { name, path, alreadyRegistered: false };
  });
}

export async function removeRepo(name: string): Promise<void> {
  return withRegistryLock(async () => {
    const registry = await readRegistryFromDisk();

    // Backfill IDs if needed
    for (const entry of registry.repos) {
      if (!entry.id) {
        entry.id = createRepoId();
      }
    }

    const idx = registry.repos.findIndex(r => r.name === name);
    if (idx === -1) {
      throw new Error(`No repo registered with name '${name}'`);
    }

    registry.repos.splice(idx, 1);
    await writeFile(registryFilePath(), JSON.stringify(registry, null, 2), 'utf-8');
  });
}
