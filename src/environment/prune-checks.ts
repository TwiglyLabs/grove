/**
 * Prune detection and cleanup functions.
 *
 * Each category has a find* (detection) and clean* (cleanup) function.
 * The prune orchestrator in api.ts calls find, then optionally clean.
 */

import { readFile, writeFile, access, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import * as lockfile from 'proper-lockfile';
import type { GroveConfig } from '../config.js';
import type {
  EnvironmentState,
  StoppedProcessEntry,
  DanglingPortEntry,
  StaleStateFileEntry,
  OrphanedNamespaceEntry,
} from './types.js';

const LOCK_OPTIONS = { retries: { retries: 60, minTimeout: 10, maxTimeout: 100, randomize: true } };

function getStateDir(config: GroveConfig): string {
  return join(config.repoRoot, '.grove');
}

async function readStateFiles(config: GroveConfig): Promise<Array<{ file: string; state: EnvironmentState }>> {
  const stateDir = getStateDir(config);
  try {
    await access(stateDir);
  } catch {
    return [];
  }

  const files = (await readdir(stateDir)).filter(f => f.endsWith('.json'));
  const results: Array<{ file: string; state: EnvironmentState }> = [];

  for (const file of files) {
    try {
      const content = await readFile(join(stateDir, file), 'utf-8');
      const state: EnvironmentState = JSON.parse(content);
      if (state.worktreeId && state.namespace) {
        results.push({ file, state });
      }
    } catch {
      // Skip invalid state files
    }
  }

  return results;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- Stopped Processes ---

export async function findStoppedProcesses(config: GroveConfig): Promise<StoppedProcessEntry[]> {
  const stateFiles = await readStateFiles(config);
  const results: StoppedProcessEntry[] = [];

  for (const { file, state } of stateFiles) {
    for (const [name, processInfo] of Object.entries(state.processes)) {
      if (!isProcessRunning(processInfo.pid)) {
        results.push({
          stateFile: file,
          processName: name,
          pid: processInfo.pid,
        });
      }
    }
  }

  return results;
}

export async function cleanStoppedProcesses(
  config: GroveConfig,
  entries: StoppedProcessEntry[],
): Promise<void> {
  // Group entries by state file
  const byFile = new Map<string, string[]>();
  for (const entry of entries) {
    const list = byFile.get(entry.stateFile) ?? [];
    list.push(entry.processName);
    byFile.set(entry.stateFile, list);
  }

  const stateDir = getStateDir(config);

  for (const [file, processNames] of byFile) {
    const filePath = join(stateDir, file);
    try {
      const release = await lockfile.lock(filePath);
      try {
        const content = await readFile(filePath, 'utf-8');
        const state: EnvironmentState = JSON.parse(content);

        for (const name of processNames) {
          delete state.processes[name];
        }

        await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
      } finally {
        await release();
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

// --- Dangling Ports ---

export async function findDanglingPorts(config: GroveConfig): Promise<DanglingPortEntry[]> {
  const stateFiles = await readStateFiles(config);
  const results: DanglingPortEntry[] = [];

  for (const { file, state } of stateFiles) {
    // A port is dangling if it's allocated but has no corresponding running process.
    // Process keys follow patterns: 'port-forward-{name}' for services, '{name}' for frontends
    const runningProcessNames = new Set<string>();
    for (const [name, processInfo] of Object.entries(state.processes)) {
      if (isProcessRunning(processInfo.pid)) {
        runningProcessNames.add(name);
      }
    }

    for (const [portName, port] of Object.entries(state.ports)) {
      // Check if there's a running process for this port
      const hasProcess =
        runningProcessNames.has(portName) ||
        runningProcessNames.has(`port-forward-${portName}`);

      if (!hasProcess) {
        results.push({
          stateFile: file,
          portName,
          port,
        });
      }
    }
  }

  return results;
}

export async function cleanDanglingPorts(
  config: GroveConfig,
  entries: DanglingPortEntry[],
): Promise<void> {
  // Group entries by state file
  const byFile = new Map<string, string[]>();
  for (const entry of entries) {
    const list = byFile.get(entry.stateFile) ?? [];
    list.push(entry.portName);
    byFile.set(entry.stateFile, list);
  }

  const stateDir = getStateDir(config);

  for (const [file, portNames] of byFile) {
    const filePath = join(stateDir, file);
    try {
      const release = await lockfile.lock(filePath);
      try {
        const content = await readFile(filePath, 'utf-8');
        const state: EnvironmentState = JSON.parse(content);

        for (const name of portNames) {
          delete state.ports[name];
          delete state.urls[name];
        }

        await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
      } finally {
        await release();
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

// --- Stale State Files ---

export async function findStaleStateFiles(config: GroveConfig): Promise<StaleStateFileEntry[]> {
  const stateFiles = await readStateFiles(config);
  if (stateFiles.length === 0) return [];

  // Gather all valid worktreeIds from active git worktrees
  const validIds = getActiveWorktreeIds(config, stateFiles);

  const results: StaleStateFileEntry[] = [];
  for (const { file, state } of stateFiles) {
    if (!validIds.has(state.worktreeId)) {
      results.push({
        file,
        worktreeId: state.worktreeId,
      });
    }
  }

  return results;
}

/**
 * Get the set of worktreeIds that correspond to active git worktrees.
 * Parses `git worktree list --porcelain` output for branch lines.
 */
function getActiveWorktreeIds(config: GroveConfig, stateFiles: Array<{ file: string; state: EnvironmentState }>): Set<string> {
  const ids = new Set<string>();

  try {
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf-8',
      cwd: config.repoRoot,
    });

    // Parse branch lines: "branch refs/heads/feature/foo"
    for (const line of output.split('\n')) {
      if (line.startsWith('branch refs/heads/')) {
        const branch = line.replace('branch refs/heads/', '');
        ids.add(sanitizeBranch(branch));
      }
    }
  } catch {
    // If git fails, return empty set — caller will flag all state files as stale.
    // This is intentionally conservative only when git is completely unavailable.
    // In practice, we want the caller to short-circuit safely.
    return new Set(stateFiles.map(s => s.state.worktreeId));
  }

  return ids;
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/\//g, '--');
}

export async function cleanStaleStateFiles(
  config: GroveConfig,
  entries: StaleStateFileEntry[],
): Promise<void> {
  const stateDir = getStateDir(config);

  for (const entry of entries) {
    const filePath = join(stateDir, entry.file);
    const exists = await access(filePath).then(() => true, () => false);
    if (!exists) continue;

    try {
      const release = await lockfile.lock(filePath, LOCK_OPTIONS);
      try {
        await unlink(filePath);
      } finally {
        await release();
      }
    } catch {
      // Best-effort cleanup — file may already be gone
      try {
        const stillExists = await access(filePath).then(() => true, () => false);
        if (stillExists) {
          await unlink(filePath);
        }
      } catch {
        // Truly gone
      }
    }
  }
}

// --- Orphaned Namespaces ---

export async function findOrphanedNamespaces(config: GroveConfig): Promise<OrphanedNamespaceEntry[]> {
  const namespacePrefix = config.project.name;
  const stateDir = getStateDir(config);

  let namespaces: string[];
  try {
    const output = execSync(
      `kubectl get namespaces -o jsonpath='{.items[*].metadata.name}'`,
      { encoding: 'utf-8' },
    );
    namespaces = output.split(' ').filter(ns => ns.startsWith(namespacePrefix));
  } catch {
    return [];
  }

  const results: OrphanedNamespaceEntry[] = [];

  for (const ns of namespaces) {
    const worktreeId = ns.substring(namespacePrefix.length + 1);
    const stateFile = join(stateDir, `${worktreeId}.json`);

    const exists = await access(stateFile).then(() => true, () => false);
    if (!exists) {
      results.push({ namespace: ns });
    }
  }

  return results;
}

export function cleanOrphanedNamespaces(entries: OrphanedNamespaceEntry[]): void {
  for (const entry of entries) {
    try {
      execSync(`kubectl delete namespace ${entry.namespace}`, { stdio: 'pipe' });
    } catch {
      // Continue with next namespace
    }
  }
}
