import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
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
const LOCK_OPTIONS_SYNC = { stale: 10000 };
const LOCK_SYNC_RETRIES = 10;
const LOCK_SYNC_RETRY_DELAY_MS = 50;
const TMP_STALENESS_MS = 60_000; // .tmp files older than 60s are considered stale

function getStateDir(config: GroveConfig): string {
  const stateDir = join(config.repoRoot, STATE_DIR_NAME);
  if (!existsSync(stateDir)) {
    mkdirSync(stateDir, { recursive: true });
  }
  return stateDir;
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
      } catch (error) {
        console.warn(`Skipping corrupt state file ${file}: ${error}`);
      }
    }
  } catch {
    // State dir might not exist yet
  }

  return usedPorts;
}

function allocatePortBlock(config: GroveConfig): Record<string, number> {
  const usedPorts = getAllUsedPorts(config);
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

export function releasePortBlock(config: GroveConfig, worktreeId: string): void {
  const stateFile = getStateFilePath(config, worktreeId);
  if (!existsSync(stateFile)) return;

  let lastError: unknown;
  for (let attempt = 0; attempt <= LOCK_SYNC_RETRIES; attempt++) {
    try {
      const release = lockfile.lockSync(stateFile, LOCK_OPTIONS_SYNC);
      try {
        unlinkSync(stateFile);
      } finally {
        release();
      }
      return; // success
    } catch (error) {
      lastError = error;
      if (attempt < LOCK_SYNC_RETRIES) {
        // Busy-wait before retrying (sync context — no async sleep available)
        const start = Date.now();
        while (Date.now() - start < LOCK_SYNC_RETRY_DELAY_MS) {
          // spin
        }
      }
    }
  }
  console.warn(`Failed to release port block for ${worktreeId} after ${LOCK_SYNC_RETRIES} retries: ${lastError}. Run \`grove prune\` to clean up stale allocations.`);
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
 * Read-only state access. Returns state without locking, or null if missing.
 * Used by test runner and utility commands that just need to read current state.
 * Pass explicit worktreeId to read state for a specific workspace branch.
 *
 * On parse failure, attempts recovery from .tmp file if one exists.
 */
export function readState(config: GroveConfig, worktreeId?: string): EnvironmentState | null {
  const id = worktreeId ?? getWorktreeId();
  const stateFile = getStateFilePath(config, id);
  const tmpFile = stateFile + '.tmp';

  // Try main file first
  if (existsSync(stateFile)) {
    try {
      const content = readFileSync(stateFile, 'utf-8');
      const parsed = JSON.parse(content);
      if (validateState(parsed)) {
        return parsed;
      }
    } catch {
      // Main file corrupt — fall through to .tmp recovery
    }
  }

  // Try .tmp recovery — only if .tmp is fresh (written within TMP_STALENESS_MS)
  if (existsSync(tmpFile)) {
    try {
      const tmpAge = Date.now() - statSync(tmpFile).mtimeMs;
      if (tmpAge > TMP_STALENESS_MS) {
        // Stale .tmp from a previous crash — discard it
        try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
      } else {
        const content = readFileSync(tmpFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (validateState(parsed)) {
          // Promote fresh .tmp to main
          try {
            renameSync(tmpFile, stateFile);
          } catch {
            // If rename fails, still return the valid state
          }
          return parsed;
        }
      }
    } catch {
      // .tmp stat/read failure — ignore
    }
  }

  return null;
}

export async function loadOrCreateState(config: GroveConfig): Promise<EnvironmentState> {
  const worktreeId = getWorktreeId();
  const stateFile = getStateFilePath(config, worktreeId);
  const branch = getCurrentBranch();

  // Try to load existing state
  if (existsSync(stateFile)) {
    try {
      const release = await lockfile.lock(stateFile, LOCK_OPTIONS);
      try {
        const content = readFileSync(stateFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (validateState(parsed)) {
          return parsed;
        }
        // Invalid structure — fall through to create new
      } finally {
        await release();
      }
    } catch (error) {
      // Lock or parse failure — try .tmp recovery before falling through
      const tmpFile = stateFile + '.tmp';
      if (existsSync(tmpFile)) {
        try {
          const tmpAge = Date.now() - statSync(tmpFile).mtimeMs;
          if (tmpAge <= TMP_STALENESS_MS) {
            const tmpContent = readFileSync(tmpFile, 'utf-8');
            const tmpParsed = JSON.parse(tmpContent);
            if (validateState(tmpParsed)) {
              try { renameSync(tmpFile, stateFile); } catch { /* best-effort */ }
              return tmpParsed;
            }
          }
        } catch {
          // .tmp recovery failed — fall through to fresh allocation
        }
      }
      console.warn(`Failed to load state, creating new: ${error}`);
    }
  }

  // Serialize port allocation with a sentinel lock to prevent races
  // between concurrent callers that both see no state file.
  const stateDir = getStateDir(config);
  const sentinelPath = join(stateDir, '.port-lock');
  try {
    writeFileSync(sentinelPath, '', { flag: 'wx' });
  } catch {
    // Already exists — expected
  }

  const releaseSentinel = await lockfile.lock(sentinelPath, LOCK_OPTIONS);
  try {
    // Double-check: another caller may have created the state while we waited
    if (existsSync(stateFile)) {
      try {
        const content = readFileSync(stateFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (validateState(parsed)) {
          return parsed;
        }
        // Invalid structure (e.g. '{}' from crashed bootstrap) — fall through to create new
      } catch {
        // Fall through to create new
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
    const release = await lockfile.lock(stateFile, LOCK_OPTIONS);
    try {
      // Atomic write: write to .tmp, then rename over main file.
      // renameSync is atomic on POSIX when source/target are on same filesystem.
      writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
      renameSync(tmpFile, stateFile);
      // Cleanup guard: ensure no stale .tmp survives for readState to find later.
      // After rename, tmpFile should not exist (rename moves it), but guard against
      // filesystem quirks or copy-on-write semantics.
      try { unlinkSync(tmpFile); } catch { /* already gone — expected */ }
    } finally {
      await release();
    }
  } catch (error) {
    // Clean up temp file on failure
    try {
      if (existsSync(tmpFile)) unlinkSync(tmpFile);
    } catch {
      // Best-effort cleanup
    }
    throw new StateWriteFailedError(error);
  }
}
