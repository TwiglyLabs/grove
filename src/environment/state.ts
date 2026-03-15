import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import * as lockfile from 'proper-lockfile';
import type { GroveConfig } from '../config.js';
import { sanitizeBranchName } from '../workspace/sanitize.js';
import type { EnvironmentState, ProcessInfo } from './types.js';
import { PortRangeExhaustedError, StateWriteFailedError } from '../shared/errors.js';

const STATE_DIR_NAME = '.grove';
const PORT_START = 10000;
const LOCK_OPTIONS = { retries: { retries: 60, minTimeout: 10, maxTimeout: 100, randomize: true } };
const TMP_STALENESS_MS = 60_000; // .tmp files older than 60s are considered stale

function getStateDir(config: GroveConfig): string {
  return join(config.repoRoot, STATE_DIR_NAME);
}

async function ensureStateDir(config: GroveConfig): Promise<string> {
  const dir = getStateDir(config);
  await mkdir(dir, { recursive: true });
  return dir;
}

function getCurrentBranch(): string {
  try {
    return execSync('git branch --show-current', { encoding: 'utf-8', timeout: 3000 }).trim();
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

async function getAllUsedPorts(config: GroveConfig): Promise<Set<number>> {
  const stateDir = getStateDir(config);
  const usedPorts = new Set<number>();

  try {
    const files = (await readdir(stateDir)).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const content = await readFile(join(stateDir, file), 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        Object.values(state.ports).forEach(port => usedPorts.add(port));
      } catch (error) {
        console.warn(`Skipping corrupt state file ${file}: ${error}`);
      }
    }
  } catch {
    // State dir might not exist yet
  }

  return usedPorts;
}

async function allocatePortBlock(config: GroveConfig): Promise<Record<string, number>> {
  const usedPorts = await getAllUsedPorts(config);
  const blockSize = config.portBlockSize;

  // Find first available block
  let startPort = PORT_START;
  while (true) {
    if (startPort + blockSize > 65536) {
      throw new PortRangeExhaustedError();
    }
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

export async function releasePortBlock(config: GroveConfig, worktreeId: string): Promise<void> {
  const stateFile = getStateFilePath(config, worktreeId);

  try {
    await access(stateFile);
  } catch {
    return; // File does not exist
  }

  try {
    const release = await lockfile.lock(stateFile, LOCK_OPTIONS);
    try {
      await unlink(stateFile);
    } finally {
      await release();
    }
  } catch (error) {
    console.warn(`Failed to release port block for ${worktreeId} after retries: ${error}. Run \`grove prune\` to clean up stale allocations.`);
  }
}

/**
 * Validates that a parsed object has the four required EnvironmentState fields.
 */
export function validateState(obj: unknown): obj is EnvironmentState {
  if (obj === null || typeof obj !== 'object') return false;
  const record = obj as Record<string, unknown>;
  return (
    typeof record.namespace === 'string' &&
    typeof record.worktreeId === 'string' &&
    typeof record.ports === 'object' && record.ports !== null && !Array.isArray(record.ports) &&
    typeof record.processes === 'object' && record.processes !== null && !Array.isArray(record.processes)
  );
}

/**
 * Reconcile loaded state with current config: if new services with portForward
 * have been added to the config since the state was created, allocate ports for
 * them. Returns true if the state was modified and needs persisting.
 */
function reconcileNewServices(state: EnvironmentState, config: GroveConfig): boolean {
  const allServices = [
    ...config.services.filter(s => s.portForward).map(s => s.name),
    ...(config.frontends ?? []).map(f => f.name),
  ];

  const missing = allServices.filter(name => !(name in state.ports));
  if (missing.length === 0) return false;

  const usedPorts = new Set(Object.values(state.ports));
  let nextPort = PORT_START;

  for (const name of missing) {
    while (usedPorts.has(nextPort)) nextPort++;
    state.ports[name] = nextPort;
    const service = config.services.find(s => s.name === name);
    const protocol = service?.health?.protocol === 'tcp' ? 'tcp' : 'http';
    if (!state.urls) state.urls = {};
    (state.urls as Record<string, string>)[name] = `${protocol}://127.0.0.1:${nextPort}`;
    usedPorts.add(nextPort);
    nextPort++;
  }

  return true;
}

/**
 * Read-only state access. Returns state without locking, or null if missing.
 * Used by test runner and utility commands that just need to read current state.
 * Pass explicit worktreeId to read state for a specific workspace branch.
 *
 * On parse failure, attempts recovery from .tmp file if one exists.
 */
export async function readState(config: GroveConfig, worktreeId?: string): Promise<EnvironmentState | null> {
  const id = worktreeId ?? getWorktreeId();
  const stateFile = getStateFilePath(config, id);
  const tmpFile = stateFile + '.tmp';

  // Try main file first
  try {
    const content = await readFile(stateFile, 'utf-8');
    const parsed = JSON.parse(content);
    if (validateState(parsed)) {
      return parsed;
    }
    // Invalid structure — fall through to .tmp recovery
  } catch {
    // Main file missing or corrupt — fall through to .tmp recovery
  }

  // Try .tmp recovery — only if .tmp is fresh (written within TMP_STALENESS_MS)
  try {
    const tmpStat = await stat(tmpFile);
    const tmpAge = Date.now() - tmpStat.mtimeMs;
    if (tmpAge > TMP_STALENESS_MS) {
      // Stale .tmp from a previous crash — discard it
      try { await unlink(tmpFile); } catch { /* best-effort cleanup */ }
    } else {
      const content = await readFile(tmpFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (validateState(parsed)) {
        // Promote fresh .tmp to main
        try {
          await rename(tmpFile, stateFile);
        } catch {
          // If rename fails, still return the valid state
        }
        return parsed;
      }
    }
  } catch {
    // .tmp stat/read failure — ignore
  }

  return null;
}

export async function loadOrCreateState(config: GroveConfig): Promise<EnvironmentState> {
  const worktreeId = getWorktreeId();
  const stateFile = getStateFilePath(config, worktreeId);
  const branch = getCurrentBranch();

  // Try to load existing state
  try {
    await access(stateFile);
    try {
      const release = await lockfile.lock(stateFile, LOCK_OPTIONS);
      try {
        const content = await readFile(stateFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (validateState(parsed)) {
          if (reconcileNewServices(parsed, config)) {
            await writeFile(stateFile, JSON.stringify(parsed, null, 2));
          }
          return parsed;
        }
        // Invalid structure — fall through to create new
      } finally {
        await release();
      }
    } catch (error) {
      // Lock or parse failure — try .tmp recovery before falling through
      const tmpFile = stateFile + '.tmp';
      try {
        await access(tmpFile);
        try {
          const tmpStat = await stat(tmpFile);
          const tmpAge = Date.now() - tmpStat.mtimeMs;
          if (tmpAge <= TMP_STALENESS_MS) {
            const tmpContent = await readFile(tmpFile, 'utf-8');
            const tmpParsed = JSON.parse(tmpContent);
            if (validateState(tmpParsed)) {
              reconcileNewServices(tmpParsed, config);
              try { await rename(tmpFile, stateFile); } catch { /* best-effort */ }
              return tmpParsed;
            }
          }
        } catch {
          // .tmp recovery failed — fall through to fresh allocation
        }
      } catch {
        // .tmp does not exist — fall through to fresh allocation
      }
      console.warn(`Failed to load state, creating new: ${error}`);
    }
  } catch {
    // State file does not exist — fall through to create new
  }

  // Serialize port allocation with a sentinel lock to prevent races
  // between concurrent callers that both see no state file.
  const stateDir = await ensureStateDir(config);
  const sentinelPath = join(stateDir, '.port-lock');
  try {
    await writeFile(sentinelPath, '', { flag: 'wx' });
  } catch {
    // Already exists — expected
  }

  const releaseSentinel = await lockfile.lock(sentinelPath, LOCK_OPTIONS);
  try {
    // Double-check: another caller may have created the state while we waited
    try {
      await access(stateFile);
      try {
        const content = await readFile(stateFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (validateState(parsed)) {
          reconcileNewServices(parsed, config);
          return parsed;
        }
        // Invalid structure (e.g. '{}' from crashed bootstrap) — fall through to create new
      } catch {
        // Fall through to create new
      }
    } catch {
      // State file does not exist — fall through to create new
    }

    // Create new state
    const ports = await allocatePortBlock(config);
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

    // Write state before returning to close the race window
    await writeState(state, config);

    return state;
  } finally {
    await releaseSentinel();
  }
}

export async function writeState(state: EnvironmentState, config: GroveConfig): Promise<void> {
  const stateFile = getStateFilePath(config, state.worktreeId);
  const tmpFile = stateFile + '.tmp';

  await ensureStateDir(config);

  // Ensure state file exists for lockfile (proper-lockfile requires it).
  // Use 'wx' flag for atomic create — no-op if file already exists.
  try {
    await writeFile(stateFile, '{}', { flag: 'wx' });
  } catch {
    // File already exists — expected
  }

  state.lastEnsure = new Date().toISOString();

  try {
    const release = await lockfile.lock(stateFile, LOCK_OPTIONS);
    try {
      // Atomic write: write to .tmp, then rename over main file.
      // rename is atomic on POSIX when source/target are on same filesystem.
      await writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
      await rename(tmpFile, stateFile);
      // Cleanup guard: ensure no stale .tmp survives for readState to find later.
      // After rename, tmpFile should not exist (rename moves it), but guard against
      // filesystem quirks or copy-on-write semantics.
      try { await unlink(tmpFile); } catch { /* already gone — expected */ }
    } finally {
      await release();
    }
  } catch (error) {
    // Clean up temp file on failure
    try {
      await access(tmpFile);
      await unlink(tmpFile);
    } catch {
      // Best-effort cleanup
    }
    throw new StateWriteFailedError(error);
  }
}
