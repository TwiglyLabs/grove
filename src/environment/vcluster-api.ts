/**
 * vCluster-based environment API.
 *
 * Orchestrates the full vCluster environment lifecycle:
 * vCluster -> platform -> databases -> services.
 *
 * This is the new API used when .grove.yaml has a `platform` key.
 * The legacy API (api.ts) continues to handle the old format.
 */

import { execSync } from 'node:child_process';
import type { GroveEnvironmentConfig } from './vcluster-config.js';
import { VClusterManager, nameFromContext } from './processes/VClusterManager.js';
import { PlatformDeployer } from './processes/PlatformDeployer.js';
import { DatabaseDeployer } from './processes/DatabaseDeployer.js';
import { ServiceDeployer } from './processes/ServiceDeployer.js';
import type { DeployAllOptions } from './processes/ServiceDeployer.js';

export interface VClusterUpOptions {
  /** If set, deploy only these service names. */
  only?: string[];
}

export interface VClusterUpResult {
  clusterName: string;
}

export interface VClusterDownResult {
  clusterName: string;
}

/**
 * Get the current git branch name.
 */
function getCurrentBranch(): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
}

/**
 * Start a vCluster-based development environment.
 *
 * Sequence:
 * 1. Derive vCluster name from project + git branch
 * 2. Create vCluster (idempotent)
 * 3. Connect to vCluster
 * 4. Deploy platform (install or upgrade)
 * 5. Deploy databases (parallel)
 * 6. Deploy services (parallel, filtered if --only provided)
 */
export async function vclusterUp(
  projectName: string,
  config: GroveEnvironmentConfig,
  options?: VClusterUpOptions,
): Promise<VClusterUpResult> {
  const branch = getCurrentBranch();
  const clusterName = nameFromContext(projectName, branch);

  const vcluster = new VClusterManager();
  const platform = new PlatformDeployer();
  const dbDeployer = new DatabaseDeployer();
  const svcDeployer = new ServiceDeployer();

  // 1. Provision vCluster
  vcluster.create(clusterName);
  vcluster.connect(clusterName);

  // 2. Platform
  platform.ensure(config.platform);

  // 3. Databases
  await dbDeployer.deployAll(config.databases);

  // 4. Services
  const deployOptions: DeployAllOptions = {};
  if (options?.only) {
    deployOptions.only = options.only;
  }
  await svcDeployer.deployAll(config.services, deployOptions);

  return { clusterName };
}

/**
 * Tear down a vCluster-based environment.
 *
 * Sequence:
 * 1. Derive vCluster name from project + git branch
 * 2. Disconnect from vCluster
 * 3. Delete vCluster
 */
export async function vclusterDown(projectName: string): Promise<VClusterDownResult> {
  const branch = getCurrentBranch();
  const clusterName = nameFromContext(projectName, branch);

  const vcluster = new VClusterManager();
  vcluster.disconnect();
  vcluster.delete(clusterName);

  return { clusterName };
}
