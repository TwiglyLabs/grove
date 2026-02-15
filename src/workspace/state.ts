import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import * as lockfile from 'proper-lockfile';
import { WorkspaceState } from './types.js';

export function getStateDir(): string {
  return process.env.GROVE_STATE_DIR || join(homedir(), '.grove', 'workspaces');
}

function ensureStateDir(): string {
  const dir = getStateDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function stateFilePath(id: string): string {
  return join(ensureStateDir(), `${id}.json`);
}

export function readWorkspaceState(id: string): WorkspaceState | null {
  const filePath = stateFilePath(id);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = WorkspaceState.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeWorkspaceState(state: WorkspaceState): Promise<void> {
  const filePath = stateFilePath(state.id);
  ensureStateDir();

  // Ensure file exists for proper-lockfile
  try {
    writeFileSync(filePath, '{}', { flag: 'wx' });
  } catch {
    // File already exists — expected
  }

  const release = await lockfile.lock(filePath);
  try {
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } finally {
    await release();
  }
}

export function deleteWorkspaceState(id: string): void {
  const filePath = stateFilePath(id);
  if (!existsSync(filePath)) return;

  try {
    const release = lockfile.lockSync(filePath);
    try {
      unlinkSync(filePath);
    } finally {
      release();
    }
  } catch {
    // File may already be gone — only retry if it still exists
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch {
      // Truly gone or inaccessible — nothing to do
    }
  }
}

export function listWorkspaceStates(): WorkspaceState[] {
  const dir = ensureStateDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  const states: WorkspaceState[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
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

export function findWorkspaceByBranch(branch: string): WorkspaceState | null {
  const states = listWorkspaceStates();
  return states.find(s => s.branch === branch) ?? null;
}
