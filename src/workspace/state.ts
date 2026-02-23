import { readFile, writeFile, mkdir, access, unlink, readdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import * as lockfile from 'proper-lockfile';
import { WorkspaceState } from './types.js';

const LOCK_OPTIONS = { retries: { retries: 60, minTimeout: 10, maxTimeout: 100, randomize: true } };

export function getStateDir(): string {
  return process.env.GROVE_STATE_DIR || join(homedir(), '.grove', 'workspaces');
}

async function ensureStateDir(): Promise<string> {
  const dir = getStateDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function stateFilePath(id: string): string {
  return join(getStateDir(), `${id}.json`);
}

export async function readWorkspaceState(id: string): Promise<WorkspaceState | null> {
  const filePath = stateFilePath(id);

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = WorkspaceState.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeWorkspaceState(state: WorkspaceState): Promise<void> {
  const filePath = stateFilePath(state.id);
  await ensureStateDir();

  // Ensure file exists for proper-lockfile
  try {
    await writeFile(filePath, '{}', { flag: 'wx' });
  } catch {
    // File already exists — expected
  }

  const release = await lockfile.lock(filePath, LOCK_OPTIONS);
  try {
    await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } finally {
    await release();
  }
}

export async function deleteWorkspaceState(id: string): Promise<void> {
  const filePath = stateFilePath(id);

  try {
    await access(filePath);
  } catch {
    return; // File doesn't exist
  }

  try {
    const release = await lockfile.lock(filePath, LOCK_OPTIONS);
    try {
      await unlink(filePath);
    } finally {
      await release();
    }
  } catch {
    // File may already be gone — only retry if it still exists
    try {
      await access(filePath);
      await unlink(filePath);
    } catch {
      // Truly gone or inaccessible — nothing to do
    }
  }
}

export async function listWorkspaceStates(): Promise<WorkspaceState[]> {
  const dir = await ensureStateDir();
  const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
  const states: WorkspaceState[] = [];

  for (const file of files) {
    try {
      const content = await readFile(join(dir, file), 'utf-8');
      const parsed = WorkspaceState.safeParse(JSON.parse(content));
      if (parsed.success) {
        states.push(parsed.data);
      }
    } catch {
      // Skip invalid state files
    }
  }

  return states;
}

export async function findWorkspaceByBranch(branch: string): Promise<WorkspaceState | null> {
  const states = await listWorkspaceStates();
  return states.find(s => s.branch === branch) ?? null;
}
