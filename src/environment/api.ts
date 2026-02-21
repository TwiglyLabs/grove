/**
 * Environment slice public API.
 *
 * Manages dev environments — start, stop, destroy, status, watch, reload, prune.
 * All operations accept RepoId and resolve config/state internally.
 */

import { execSync, spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { load as loadConfig } from '../shared/config.js';
import type { GroveConfig } from '../config.js';
import type { RepoId } from '../shared/identity.js';
import { EnvironmentNotRunningError, NamespaceDeletionFailedError } from '../shared/errors.js';
import type {
  EnvironmentEvents,
  UpOptions,
  UpResult,
  DownResult,
  DestroyResult,
  DashboardData,
  WatchHandle,
  PruneOptions,
  PruneResult,
  HealthCheckResult,
  SupervisorHandle,
} from './types.js';

import { ensureEnvironment as internalEnsure } from './controller.js';
import { readState as internalReadState, releasePortBlock, writeState } from './state.js';
import { FileWatcher } from './watcher.js';
import { BuildOrchestrator } from './processes/BuildOrchestrator.js';
import { createClusterProvider } from './providers/index.js';
import { Timer } from './timing.js';
import { registerCleanupHandler, unregisterCleanupHandler } from './signals.js';
import { isProcessRunning, isGroveProcess } from './process-check.js';

/** Module-level supervisor reference for lifecycle management. */
let activeSupervisor: SupervisorHandle | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kill a process with SIGTERM→wait→SIGKILL escalation.
 * Returns whether the process was killed and whether SIGKILL was needed.
 */
export async function killProcess(
  pid: number,
  timeoutMs: number = 5000,
): Promise<{ killed: boolean; escalated: boolean }> {
  if (!isProcessRunning(pid)) {
    return { killed: true, escalated: false };
  }

  // Phase 1: SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return { killed: true, escalated: false };
  }

  // Phase 2: Poll for death
  const pollInterval = 100;
  const maxPolls = Math.ceil(timeoutMs / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);
    if (!isProcessRunning(pid)) {
      return { killed: true, escalated: false };
    }
  }

  // Phase 3: SIGKILL escalation
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return { killed: true, escalated: true };
  }

  // Phase 4: Verify dead
  await sleep(200);
  const dead = !isProcessRunning(pid);
  return { killed: dead, escalated: true };
}

/**
 * Start (or ensure) a dev environment. Returns when fully healthy.
 */
export async function up(
  repo: RepoId,
  options?: UpOptions,
  _events?: EnvironmentEvents,
): Promise<UpResult> {
  const config = await loadConfig(repo);
  const timer = new Timer();

  const { state, health, supervisor } = await internalEnsure(config, {
    frontend: options?.frontend,
    all: options?.all,
  });

  // Track supervisor for lifecycle management — stop old one first to prevent leaks
  if (supervisor) {
    if (activeSupervisor) {
      await activeSupervisor.stop();
    }
    activeSupervisor = supervisor;
  }

  // Register signal handlers for clean shutdown on SIGINT/SIGTERM
  registerCleanupHandler(down, repo);

  return {
    state,
    urls: state.urls,
    ports: state.ports,
    duration: timer.elapsed(),
    health,
    supervisor,
  };
}

/**
 * Stop all processes, keep namespace and state.
 * Uses SIGTERM→wait→SIGKILL escalation and cleans dead entries from state.
 */
export async function down(
  repo: RepoId,
  _options?: { signal?: AbortSignal },
  _events?: EnvironmentEvents,
): Promise<DownResult> {
  // Unregister signal handlers to prevent re-entrant down() calls
  unregisterCleanupHandler();

  const config = await loadConfig(repo);
  const state = internalReadState(config);

  if (!state) {
    return { stopped: [], notRunning: [] };
  }

  // Stop supervisor before killing processes — await to drain in-flight checks
  if (activeSupervisor) {
    await activeSupervisor.stop();
    activeSupervisor = null;
  }

  const stopped: DownResult['stopped'] = [];
  const notRunning: string[] = [];

  for (const [name, processInfo] of Object.entries(state.processes)) {
    if (!isGroveProcess(processInfo.pid)) {
      notRunning.push(name);
      delete state.processes[name];
      continue;
    }

    const result = await killProcess(processInfo.pid);
    stopped.push({
      name,
      pid: processInfo.pid,
      success: result.killed,
      escalated: result.escalated,
    });

    if (result.killed) {
      delete state.processes[name];
    }
  }

  // Write cleaned state
  try {
    await writeState(state, config);
  } catch (error) {
    console.warn(`Warning: could not save state after stop — run \`grove prune\` to clean up. ${error}`);
  }

  return { stopped, notRunning };
}

/**
 * Stop processes, delete namespace (waiting for completion), remove state.
 */
export async function destroy(
  repo: RepoId,
  _options?: { signal?: AbortSignal },
  _events?: EnvironmentEvents,
): Promise<DestroyResult> {
  const config = await loadConfig(repo);

  // Stop processes first
  const downResult = await down(repo);

  const state = internalReadState(config);

  if (!state) {
    return {
      stopped: downResult,
      namespaceDeleted: false,
      stateRemoved: false,
    };
  }

  // Delete namespace — wait for full deletion to prevent stale resources on quick destroy→up
  let namespaceDeleted = false;
  try {
    execSync(
      `kubectl delete namespace ${state.namespace} --wait=true --timeout=60s`,
      { stdio: 'pipe', timeout: 70_000 },
    );
    namespaceDeleted = true;
  } catch {
    // Namespace may not exist or deletion timed out
  }

  // Remove state file
  let stateRemoved = false;
  try {
    releasePortBlock(config, state.worktreeId);
    stateRemoved = true;
  } catch {
    // State file may not exist
  }

  return {
    stopped: downResult,
    namespaceDeleted,
    stateRemoved,
  };
}

/**
 * Get current environment status as structured data.
 */
export async function status(repo: RepoId): Promise<DashboardData | null> {
  const config = await loadConfig(repo);
  const state = internalReadState(config);

  if (!state) {
    return null;
  }

  // Build service entries
  const services: DashboardData['services'] = config.services
    .filter(s => s.portForward)
    .map(s => {
      const processKey = `port-forward-${s.name}`;
      const processInfo = state.processes[processKey];
      const running = processInfo ? isGroveProcess(processInfo.pid) : false;

      return {
        name: s.name,
        status: running ? 'running' as const : 'stopped' as const,
        port: state.ports[s.name],
        url: state.urls[s.name],
        pid: processInfo?.pid,
      };
    });

  // Build frontend entries
  const frontends: DashboardData['frontends'] = (config.frontends ?? []).map(f => {
    const processInfo = state.processes[f.name];
    const running = processInfo ? isGroveProcess(processInfo.pid) : false;

    return {
      name: f.name,
      status: running ? 'running' as const : 'stopped' as const,
      url: state.urls[f.name],
      pid: processInfo?.pid,
    };
  });

  // Determine overall state
  const allEntries = [...services, ...frontends];
  const allRunning = allEntries.every(e => e.status === 'running');
  const anyRunning = allEntries.some(e => e.status === 'running');

  let overallState: DashboardData['state'];
  if (allEntries.length === 0) {
    overallState = 'unknown';
  } else if (allRunning) {
    overallState = 'healthy';
  } else if (anyRunning) {
    overallState = 'degraded';
  } else {
    overallState = 'down';
  }

  // Calculate uptime from lastEnsure
  const uptime = state.lastEnsure
    ? Math.floor((Date.now() - new Date(state.lastEnsure).getTime()) / 1000)
    : undefined;

  return {
    state: overallState,
    namespace: state.namespace,
    services,
    frontends,
    uptime,
  };
}

/**
 * Start file watcher — returns a controller handle.
 */
export async function watch(
  repo: RepoId,
  events?: EnvironmentEvents,
): Promise<WatchHandle> {
  const config = await loadConfig(repo);
  const state = internalReadState(config);

  if (!state) {
    throw new EnvironmentNotRunningError();
  }

  const watcher = new FileWatcher(config, state, events);
  watcher.start();

  return {
    stop() {
      watcher.stop();
    },
    reload(service: string) {
      const serviceConfig = config.services.find(s => s.name === service);
      if (!serviceConfig) {
        return;
      }
      // Trigger a rebuild via the orchestrator
      const provider = createClusterProvider(config.project.clusterType);
      const orchestrator = new BuildOrchestrator(config, state, provider);
      orchestrator.buildService(serviceConfig);
      orchestrator.loadImage(serviceConfig);
      orchestrator.helmUpgrade();
    },
  };
}

/**
 * Signal the running watcher to reload a service via .reload-request file.
 */
export async function reload(
  repo: RepoId,
  service: string,
): Promise<void> {
  const config = await loadConfig(repo);
  const state = internalReadState(config);

  if (!state) {
    throw new EnvironmentNotRunningError();
  }

  writeFileSync(join(config.repoRoot, '.reload-request'), service + '\n');
}

/**
 * Clean up orphaned resources: dead processes, dangling ports,
 * stale state files, orphaned worktrees, orphaned namespaces.
 *
 * Order: processes → ports → state files → worktrees → namespaces
 */
export async function prune(repo: RepoId, options?: PruneOptions): Promise<PruneResult> {
  const config = await loadConfig(repo);
  const dryRun = options?.dryRun ?? false;

  const result: PruneResult = {
    stoppedProcesses: [],
    danglingPorts: [],
    staleStateFiles: [],
    orphanedWorktrees: [],
    orphanedNamespaces: [],
    dryRun,
  };

  // Step 1: Clean stopped processes
  result.stoppedProcesses = await pruneStoppedProcesses(config, dryRun);

  // Step 2: Clean dangling ports
  result.danglingPorts = await pruneDanglingPorts(config, dryRun);

  // Step 3: Clean stale state files
  result.staleStateFiles = await pruneStaleStateFiles(config, dryRun);

  // Step 4: Clean orphaned worktrees
  result.orphanedWorktrees = await pruneOrphanedWorktrees(dryRun);

  // Step 5: Clean orphaned namespaces
  result.orphanedNamespaces = await pruneOrphanedNamespaces(config, dryRun);

  return result;
}

// --- Prune sub-functions ---

import * as pruneChecks from './prune-checks.js';
import {
  findOrphanedWorktrees as findOrphanedWs,
  cleanOrphanedWorktrees as cleanOrphanedWs,
} from '../workspace/api.js';
import type {
  StoppedProcessEntry,
  DanglingPortEntry,
  StaleStateFileEntry,
  OrphanedWorktreeEntry,
  OrphanedNamespaceEntry,
} from './types.js';

async function pruneStoppedProcesses(config: GroveConfig, dryRun: boolean): Promise<StoppedProcessEntry[]> {
  const entries = pruneChecks.findStoppedProcesses(config);
  if (!dryRun && entries.length > 0) {
    await pruneChecks.cleanStoppedProcesses(config, entries);
  }
  return entries;
}

async function pruneDanglingPorts(config: GroveConfig, dryRun: boolean): Promise<DanglingPortEntry[]> {
  const entries = pruneChecks.findDanglingPorts(config);
  if (!dryRun && entries.length > 0) {
    await pruneChecks.cleanDanglingPorts(config, entries);
  }
  return entries;
}

async function pruneStaleStateFiles(config: GroveConfig, dryRun: boolean): Promise<StaleStateFileEntry[]> {
  const entries = pruneChecks.findStaleStateFiles(config);
  if (!dryRun && entries.length > 0) {
    pruneChecks.cleanStaleStateFiles(config, entries);
  }
  return entries;
}

async function pruneOrphanedWorktrees(dryRun: boolean): Promise<OrphanedWorktreeEntry[]> {
  const entries = findOrphanedWs();
  if (!dryRun && entries.length > 0) {
    cleanOrphanedWs(entries);
  }
  return entries;
}

async function pruneOrphanedNamespaces(config: GroveConfig, dryRun: boolean): Promise<OrphanedNamespaceEntry[]> {
  const entries = pruneChecks.findOrphanedNamespaces(config);
  if (!dryRun && entries.length > 0) {
    pruneChecks.cleanOrphanedNamespaces(entries);
  }
  return entries;
}
