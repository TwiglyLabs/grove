import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import * as lockfile from 'proper-lockfile';
import type { GroveConfig } from '../config.js';
import { sanitizeBranchName } from '../workspace/sanitize.js';
import type { EnvironmentState, ProcessInfo } from './types.js';

const STATE_DIR_NAME = '.grove';
const PORT_START = 10000;

function getStateDir(config: GroveConfig): string {
  const stateDir = join(config.repoRoot, STATE_DIR_NAME);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  return stateDir;
}

function getCurrentBranch(): string {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  } catch {
    return 'main';
  }
}

function getWorktreeId(): string {
  const branch = getCurrentBranch();
  return sanitizeBranchName(branch);
}

function getStateFilePath(config: GroveConfig, worktreeId?: string): string {
  const id = worktreeId || getWorktreeId();
  return join(getStateDir(config), `${id}.json`);
}

function getAllUsedPorts(config: GroveConfig): Set<number> {
  const stateDir = getStateDir(config);
  const usedPorts = new Set<number>();

  try {
    const files = readdirSync(stateDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = readFileSync(join(stateDir, file), 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        Object.values(state.ports).forEach(port => usedPorts.add(port));
      } catch {
        // Skip invalid state files
      }
    }
  } catch {
    // State dir might not exist yet
  }

  return usedPorts;
}

export function allocatePortBlock(config: GroveConfig): Record<string, number> {
  const usedPorts = getAllUsedPorts(config);
  const blockSize = config.portBlockSize;

  // Find first available block
  let startPort = PORT_START;
  while (true) {
    let blockAvailable = true;
    for (let i = 0; i < blockSize; i++) {
      if (usedPorts.has(startPort + i)) {
        blockAvailable = false;
        break;
      }
    }

    if (blockAvailable) {
      break;
    }

    startPort += blockSize;
  }

  // Allocate ports for services with portForward and frontends
  const ports: Record<string, number> = {};
  let offset = 0;

  for (const service of config.services) {
    if (!service.portForward) continue;
    ports[service.name] = startPort + offset;
    offset++;
  }

  if (config.frontends) {
    for (const frontend of config.frontends) {
      ports[frontend.name] = startPort + offset;
      offset++;
    }
  }

  return ports;
}

export function releasePortBlock(config: GroveConfig, worktreeId: string): void {
  const stateFile = getStateFilePath(config, worktreeId);
  if (existsSync(stateFile)) {
    try {
      const release = lockfile.lockSync(stateFile);
      try {
        unlinkSync(stateFile);
      } finally {
        release();
      }
    } catch (error) {
      console.warn(`Failed to release port block: ${error}`);
    }
  }
}

/**
 * Read-only state access. Returns state without locking, or null if missing.
 * Used by test runner and utility commands that just need to read current state.
 */
export function readState(config: GroveConfig): EnvironmentState | null {
  const worktreeId = getWorktreeId();
  const stateFile = getStateFilePath(config, worktreeId);

  if (!existsSync(stateFile)) {
    return null;
  }

  try {
    const content = readFileSync(stateFile, 'utf-8');
    return JSON.parse(content) as EnvironmentState;
  } catch {
    return null;
  }
}

export async function loadOrCreateState(config: GroveConfig): Promise<EnvironmentState> {
  const worktreeId = getWorktreeId();
  const stateFile = getStateFilePath(config, worktreeId);
  const branch = getCurrentBranch();

  // Try to load existing state
  if (existsSync(stateFile)) {
    try {
      const release = await lockfile.lock(stateFile);
      try {
        const content = readFileSync(stateFile, 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        return state;
      } finally {
        await release();
      }
    } catch (error) {
      console.warn(`Failed to load state, creating new: ${error}`);
    }
  }

  // Create new state
  const ports = allocatePortBlock(config);
  const urls: Record<string, string> = {};

  // Generate URLs for services with ports
  for (const service of config.services) {
    if (!service.portForward) continue;
    const port = ports[service.name];
    const protocol = service.health?.protocol === 'tcp' ? 'tcp' : 'http';
    urls[service.name] = `${protocol}://127.0.0.1:${port}`;
  }

  // Generate URLs for frontends
  if (config.frontends) {
    for (const frontend of config.frontends) {
      const port = ports[frontend.name];
      urls[frontend.name] = `http://127.0.0.1:${port}`;
    }
  }

  const namespace = `${config.project.name}-${worktreeId}`;

  const state: EnvironmentState = {
    namespace,
    branch,
    worktreeId,
    ports,
    urls,
    processes: {},
    lastEnsure: new Date().toISOString(),
  };

  return state;
}

export async function writeState(state: EnvironmentState, config: GroveConfig): Promise<void> {
  const stateFile = getStateFilePath(config, state.worktreeId);
  const stateDir = getStateDir(config);

  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }

  // Ensure state file exists for lockfile (proper-lockfile requires it).
  // Use 'wx' flag for atomic create — no-op if file already exists.
  try {
    writeFileSync(stateFile, '{}', { flag: 'wx' });
  } catch {
    // File already exists — expected
  }

  state.lastEnsure = new Date().toISOString();

  try {
    const release = await lockfile.lock(stateFile);
    try {
      writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf-8');
    } finally {
      await release();
    }
  } catch (error) {
    throw new Error(`Failed to write state: ${error}`);
  }
}
