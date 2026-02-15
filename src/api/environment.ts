/**
 * Grove API: Environment module
 *
 * Manages dev environments — start, stop, destroy, status, watch, reload, prune.
 * All operations accept RepoId and resolve config/state internally.
 */

import { spawn } from 'child_process';
import { load as loadConfig } from './config.js';
import type { RepoId } from './identity.js';
import { EnvironmentNotRunningError } from './errors.js';
import type { EnvironmentEvents } from './events.js';
import type {
  UpOptions,
  UpResult,
  DownResult,
  DestroyResult,
  DashboardData,
  WatchHandle,
  PruneResult,
} from './types.js';

import { ensureEnvironment as internalEnsure } from '../controller.js';
import { readState as internalReadState, releasePortBlock } from '../state.js';
import { FileWatcher } from '../watcher.js';
import { BuildOrchestrator } from '../processes/BuildOrchestrator.js';
import { Timer } from '../timing.js';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

  const state = await internalEnsure(config, {
    frontend: options?.frontend,
    all: options?.all,
  });

  return {
    state,
    urls: state.urls,
    ports: state.ports,
    duration: timer.elapsed(),
  };
}

/**
 * Stop all processes, keep namespace and state.
 */
export async function down(
  repo: RepoId,
  _options?: { signal?: AbortSignal },
  _events?: EnvironmentEvents,
): Promise<DownResult> {
  const config = await loadConfig(repo);
  const state = internalReadState(config);

  if (!state) {
    return { stopped: [], notRunning: [] };
  }

  const stopped: DownResult['stopped'] = [];
  const notRunning: string[] = [];

  for (const [name, processInfo] of Object.entries(state.processes)) {
    if (!isProcessRunning(processInfo.pid)) {
      notRunning.push(name);
      continue;
    }

    try {
      process.kill(processInfo.pid, 'SIGTERM');
      stopped.push({ name, pid: processInfo.pid, success: true });
    } catch {
      stopped.push({ name, pid: processInfo.pid, success: false });
    }
  }

  return { stopped, notRunning };
}

/**
 * Stop processes, delete namespace, remove state.
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

  // Delete namespace
  let namespaceDeleted = false;
  try {
    const proc = spawn('kubectl', ['delete', 'namespace', state.namespace], {
      stdio: 'pipe',
    });
    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve());
      proc.on('error', () => resolve());
    });
    namespaceDeleted = true;
  } catch {
    // Namespace may not exist
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
      const running = processInfo ? isProcessRunning(processInfo.pid) : false;

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
    const running = processInfo ? isProcessRunning(processInfo.pid) : false;

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

  const watcher = new FileWatcher(config, state);
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
      const orchestrator = new BuildOrchestrator(config, state);
      orchestrator.buildService(serviceConfig);
      orchestrator.loadImageToKind(serviceConfig);
      orchestrator.helmUpgrade();
    },
  };
}

/**
 * Trigger a single service rebuild without an active watch session.
 */
export async function reload(
  repo: RepoId,
  service: string,
  _events?: EnvironmentEvents,
): Promise<void> {
  const config = await loadConfig(repo);
  const state = internalReadState(config);

  if (!state) {
    throw new EnvironmentNotRunningError();
  }

  const serviceConfig = config.services.find(s => s.name === service);
  if (!serviceConfig) {
    throw new Error(`Service '${service}' not found in config`);
  }

  const orchestrator = new BuildOrchestrator(config, state);
  orchestrator.buildService(serviceConfig);
  orchestrator.loadImageToKind(serviceConfig);
  orchestrator.helmUpgrade();
}

/**
 * Clean up orphaned namespaces matching this repo's project prefix.
 */
export async function prune(repo: RepoId): Promise<PruneResult> {
  const config = await loadConfig(repo);

  // The internal pruneOrphanedResources() is void and prints output.
  // We reimplement with structured data return instead.
  const { execSync } = await import('child_process');
  const { existsSync } = await import('fs');

  const namespacePrefix = config.project.name;

  // Get all namespaces with our prefix
  let namespaces: string[] = [];
  try {
    const output = execSync(
      `kubectl get namespaces -o jsonpath='{.items[*].metadata.name}'`,
      { encoding: 'utf-8' },
    );
    namespaces = output.split(' ').filter(ns => ns.startsWith(namespacePrefix));
  } catch {
    return { deleted: [], kept: [] };
  }

  const stateDir = `${config.repoRoot}/.grove`;
  const deleted: string[] = [];
  const kept: string[] = [];

  for (const ns of namespaces) {
    const worktreeId = ns.substring(namespacePrefix.length + 1);
    const stateFile = `${stateDir}/${worktreeId}.json`;

    if (!existsSync(stateFile)) {
      try {
        execSync(`kubectl delete namespace ${ns}`, { stdio: 'pipe' });
        deleted.push(ns);
      } catch {
        kept.push(ns);
      }
    } else {
      kept.push(ns);
    }
  }

  return { deleted, kept };
}
