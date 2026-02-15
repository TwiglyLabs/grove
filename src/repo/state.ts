import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as lockfile from 'proper-lockfile';
import { RepoRegistry, type RepoEntry } from './types.js';

export function getRegistryDir(): string {
  return process.env.GROVE_REGISTRY_DIR || join(homedir(), '.grove');
}

function ensureRegistryDir(): string {
  const dir = getRegistryDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function registryFilePath(): string {
  return join(ensureRegistryDir(), 'repos.json');
}

function emptyRegistry(): RepoRegistry {
  return { version: 1, repos: [] };
}

export function readRegistry(): RepoRegistry {
  const filePath = registryFilePath();
  if (!existsSync(filePath)) return emptyRegistry();

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = RepoRegistry.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : emptyRegistry();
  } catch {
    return emptyRegistry();
  }
}

async function writeRegistry(registry: RepoRegistry): Promise<void> {
  const filePath = registryFilePath();
  ensureRegistryDir();

  // Ensure file exists for proper-lockfile
  try {
    writeFileSync(filePath, '{}', { flag: 'wx' });
  } catch {
    // File already exists — expected
  }

  const release = await lockfile.lock(filePath);
  try {
    writeFileSync(filePath, JSON.stringify(registry, null, 2), 'utf-8');
  } finally {
    await release();
  }
}

export interface AddResult {
  name: string;
  path: string;
  alreadyRegistered: boolean;
}

export async function addRepo(name: string, path: string): Promise<AddResult> {
  const registry = readRegistry();

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

  const entry: RepoEntry = {
    name,
    path,
    addedAt: new Date().toISOString(),
  };

  registry.repos.push(entry);
  await writeRegistry(registry);

  return { name, path, alreadyRegistered: false };
}

export async function removeRepo(name: string): Promise<void> {
  const registry = readRegistry();

  const idx = registry.repos.findIndex(r => r.name === name);
  if (idx === -1) {
    throw new Error(`No repo registered with name '${name}'`);
  }

  registry.repos.splice(idx, 1);
  await writeRegistry(registry);
}
