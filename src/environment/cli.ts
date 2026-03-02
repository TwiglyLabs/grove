/**
 * Environment slice CLI commands.
 *
 * Commander subcommands for grove up, down, destroy, status, watch, reload, prune.
 */

import chalk from 'chalk';
import type { RepoId } from '../shared/identity.js';
import { EnvironmentNotRunningError } from '../shared/errors.js';
import { load as loadConfig } from '../shared/config.js';
import {
  printBanner,
  printUrlTable,
  printInfo,
  printSuccess,
  printWarning,
  printError,
} from '../shared/output.js';
import * as api from './api.js';

// --- Up ---

export interface UpCommandOptions {
  frontend?: string;
  all?: boolean;
}

export async function upCommand(repoId: RepoId, options: UpCommandOptions): Promise<void> {
  const config = await loadConfig(repoId);
  printBanner(config.project.name);

  const result = await api.up(repoId, options);

  printUrlTable(result.urls);
}

// --- Down ---

export async function downCommand(repoId: RepoId): Promise<void> {
  printInfo('Stopping processes...');

  const result = await api.down(repoId);

  if (result.stopped.length === 0 && result.notRunning.length === 0) {
    printWarning('No state file found - environment may not be running');
    return;
  }

  for (const entry of result.stopped) {
    if (entry.success) {
      printSuccess(`Stopped ${entry.name} (PID: ${entry.pid})`);
    } else {
      printWarning(`Failed to stop ${entry.name} (PID: ${entry.pid})`);
    }
  }

  for (const name of result.notRunning) {
    printWarning(`${name} - already stopped`);
  }

  printSuccess('All processes stopped');
}

// --- Destroy ---

export async function destroyCommand(repoId: RepoId): Promise<void> {
  const result = await api.destroy(repoId);

  // Report process stoppage
  for (const entry of result.stopped.stopped) {
    if (entry.success) {
      printSuccess(`Stopped ${entry.name} (PID: ${entry.pid})`);
    } else {
      printWarning(`Failed to stop ${entry.name} (PID: ${entry.pid})`);
    }
  }

  // Report namespace deletion
  if (result.namespaceDeleted) {
    printSuccess('Namespace deleted');
  } else {
    printWarning('Failed to delete namespace - it may not exist');
  }

  // Report state removal
  if (result.stateRemoved) {
    printSuccess('State file removed');
  } else {
    printWarning('Failed to remove state file');
  }

  printSuccess('Environment destroyed');
}

// --- Status ---

export async function statusCommand(repoId: RepoId): Promise<void> {
  const data = await api.status(repoId);

  if (!data) {
    printWarning('No state file found - environment is not running');
    return;
  }

  const stateColor = data.state === 'healthy' ? chalk.green
    : data.state === 'degraded' ? chalk.yellow
    : chalk.red;

  console.log('');
  console.log(chalk.bold('Environment Status'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  State:       ${stateColor(data.state.toUpperCase())}`);
  console.log(`  Namespace:   ${chalk.cyan(data.namespace)}`);
  if (data.uptime !== undefined) {
    const mins = Math.floor(data.uptime / 60);
    const hrs = Math.floor(mins / 60);
    const uptimeStr = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
    console.log(`  Uptime:      ${uptimeStr}`);
  }
  console.log('');

  // Services
  if (data.services.length > 0) {
    console.log(chalk.bold('Services'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const s of data.services) {
      const icon = s.status === 'running' ? chalk.green('●') : chalk.red('●');
      const portStr = s.port ? `  :${s.port}` : '';
      console.log(`  ${icon} ${s.name.padEnd(20)} ${s.status}${portStr}`);
    }
    console.log('');
  }

  // Frontends
  if (data.frontends.length > 0) {
    console.log(chalk.bold('Frontends'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const f of data.frontends) {
      const icon = f.status === 'running' ? chalk.green('●') : chalk.red('●');
      console.log(`  ${icon} ${f.name.padEnd(20)} ${f.status}`);
    }
    console.log('');
  }

  // URLs
  const urls: Record<string, string> = {};
  for (const s of data.services) if (s.url) urls[s.name] = s.url;
  for (const f of data.frontends) if (f.url) urls[f.name] = f.url;

  if (Object.keys(urls).length > 0) {
    console.log(chalk.bold('URLs'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const [name, url] of Object.entries(urls)) {
      console.log(`  ${name.padEnd(20)} ${chalk.underline(url)}`);
    }
    console.log('');
  }
}

// --- Watch ---

export async function watchCommand(repoId: RepoId): Promise<void> {
  let handle;
  try {
    handle = await api.watch(repoId);
  } catch (error) {
    if (error instanceof EnvironmentNotRunningError) {
      printWarning('No state file found - run "grove up" first');
      return;
    }
    throw error;
  }

  printInfo('Press Ctrl+C to stop watching');

  // Keep process alive
  process.on('SIGINT', () => {
    handle.stop();
    process.exit(0);
  });
}

// --- Prune ---

export async function pruneCommand(repoId: RepoId, options?: { dryRun?: boolean }): Promise<void> {
  const dryRun = options?.dryRun ?? false;
  printInfo(dryRun ? 'Checking for orphaned resources (dry run)...' : 'Checking for orphaned resources...');

  const result = await api.prune(repoId, { dryRun });

  const prefix = dryRun ? '[dry run] Would clean' : 'Cleaned';

  for (const entry of result.stoppedProcesses) {
    printWarning(`${prefix} dead process: ${entry.processName} (PID ${entry.pid}) in ${entry.stateFile}`);
  }

  for (const entry of result.danglingPorts) {
    printWarning(`${prefix} dangling port: ${entry.portName} (port ${entry.port}) in ${entry.stateFile}`);
  }

  for (const entry of result.staleStateFiles) {
    printWarning(`${prefix} stale state file: ${entry.file} (worktree ${entry.worktreeId} missing)`);
  }

  for (const entry of result.orphanedWorktrees) {
    printWarning(`${prefix} orphaned worktree: ${entry.path}`);
  }

  for (const entry of result.orphanedNamespaces) {
    printWarning(`${prefix} orphaned namespace: ${entry.namespace}`);
  }

  const total =
    result.stoppedProcesses.length +
    result.danglingPorts.length +
    result.staleStateFiles.length +
    result.orphanedWorktrees.length +
    result.orphanedNamespaces.length;

  if (total === 0) {
    printSuccess('No orphaned resources found');
  } else {
    printSuccess(`${dryRun ? 'Would clean' : 'Cleaned'} ${total} orphaned resource(s)`);
  }
}

// --- Reload ---

export async function reloadCommand(repoId: RepoId, service?: string): Promise<void> {
  const config = await loadConfig(repoId);
  const targets = config.services.filter(s => s.build).map(s => s.name);

  if (!service) {
    printError('Usage: grove reload <service>');
    console.log(`Valid services: ${targets.join(', ')}`);
    process.exit(1);
  }

  if (!targets.includes(service)) {
    printError(`Unknown service: ${service}`);
    console.log(`Valid services: ${targets.join(', ')}`);
    process.exit(1);
  }

  try {
    await api.reload(repoId, service);
  } catch (error) {
    if (error instanceof EnvironmentNotRunningError) {
      printError('Dev environment not running. Run `grove up` first.');
      process.exit(1);
    }
    throw error;
  }

  console.log(`Reload requested for ${service}. Watch the grove watch console for progress.`);
}
