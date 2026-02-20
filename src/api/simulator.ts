/**
 * Grove API: Simulator module
 *
 * iOS simulator management. Operations that need repo context
 * resolve config and environment state from RepoId internally.
 */

import { load as loadConfig } from '../shared/config.js';
import { readState } from '../environment/state.js';
import type { RepoId } from '../shared/identity.js';
import { EnvironmentNotRunningError } from '../shared/errors.js';
import type { SimulatorInfo } from './types.js';
import {
  ensureSimulator as internalEnsure,
  shutdownSimulator as internalShutdown,
  deleteSimulator as internalDelete,
  installApp as internalInstall,
  connectToMetro as internalConnect,
  listProjectSimulators as internalList,
  findAppBinary,
} from '../simulator/simulator.js';

/**
 * Clone (or ensure) a simulator for this repo's branch.
 * Creates a cloned simulator from the base device if one doesn't exist.
 */
export async function cloneSimulator(repo: RepoId): Promise<SimulatorInfo> {
  const config = await loadConfig(repo);

  if (!config.simulator) {
    throw new Error('No simulator configuration found in .grove.yaml');
  }

  const state = readState(config);
  const branch = state?.branch ?? 'main';

  const result = await internalEnsure(config.simulator, branch);

  return {
    udid: result.udid,
    name: result.name,
    status: result.status,
    basedOn: result.basedOn,
  };
}

/**
 * Boot a simulator by UDID.
 */
export async function bootSimulator(udid: string): Promise<void> {
  const { execSync } = await import('child_process');
  try {
    execSync(`xcrun simctl boot ${udid}`, { encoding: 'utf-8' });
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('current state: Booted')) {
      throw err;
    }
  }
}

/**
 * Shutdown a simulator by UDID.
 */
export async function shutdownSimulator(udid: string): Promise<void> {
  await internalShutdown(udid);
}

/**
 * Delete a simulator by UDID.
 */
export async function deleteSimulator(udid: string): Promise<void> {
  await internalDelete(udid);
}

/**
 * Install the app on a simulator. Returns the app binary path.
 */
export async function installApp(repo: RepoId, udid: string): Promise<string> {
  const config = await loadConfig(repo);

  if (!config.simulator) {
    throw new Error('No simulator configuration found in .grove.yaml');
  }

  await internalInstall(udid, config.simulator.appName);

  // Return the install path
  const appPath = findAppBinary(config.simulator.appName);
  return appPath ?? '';
}

/**
 * Connect simulator to Metro dev server.
 * Resolves the Metro URL from the repo's environment state.
 */
export async function connectMetro(repo: RepoId, udid: string): Promise<void> {
  const config = await loadConfig(repo);

  if (!config.simulator) {
    throw new Error('No simulator configuration found in .grove.yaml');
  }

  const state = readState(config);
  if (!state) {
    throw new EnvironmentNotRunningError();
  }

  const metroFrontend = config.simulator.metroFrontend;
  const metroUrl = state.urls[metroFrontend];

  if (!metroUrl) {
    throw new Error(`Metro frontend '${metroFrontend}' not found in environment state`);
  }

  internalConnect(udid, metroUrl, config.simulator.deepLinkScheme);
}

/**
 * List all simulators matching the project prefix.
 */
export async function listSimulators(prefix: string): Promise<SimulatorInfo[]> {
  const devices = internalList(prefix);

  return devices.map(d => ({
    udid: d.udid,
    name: d.name,
    status: d.state === 'Booted' ? 'booted' as const
      : d.state === 'Shutdown' ? 'shutdown' as const
      : 'unknown' as const,
    basedOn: '',
  }));
}
