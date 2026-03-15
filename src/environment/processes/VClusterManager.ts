/**
 * Manages vCluster lifecycle within the shared Kind cluster.
 *
 * Wraps the `vcluster` CLI. Each Grove environment gets its own vCluster,
 * named after the project and git branch.
 */

import { execSync } from 'node:child_process';

export class VClusterManager {
  /**
   * Create a vCluster if it does not already exist.
   */
  create(name: string, namespace: string = 'vcluster-system'): void {
    if (this.exists(name)) return;
    execSync(`vcluster create ${name} --namespace ${namespace}`, { stdio: 'inherit' });
  }

  /**
   * Connect to a vCluster (switches kubectl context).
   */
  connect(name: string): void {
    execSync(`vcluster connect ${name}`, { stdio: 'inherit' });
  }

  /**
   * Disconnect from the current vCluster (restores previous kubectl context).
   */
  disconnect(): void {
    execSync(`vcluster disconnect`, { stdio: 'inherit' });
  }

  /**
   * Delete a vCluster.
   */
  delete(name: string): void {
    execSync(`vcluster delete ${name}`, { stdio: 'inherit' });
  }

  /**
   * Check whether a vCluster with the given name exists.
   */
  exists(name: string): boolean {
    try {
      const output = execSync(`vcluster list --output json`, { encoding: 'utf-8' });
      const clusters = JSON.parse(output) as Array<{ Name: string }>;
      return clusters.some((c) => c.Name === name);
    } catch {
      return false;
    }
  }

  /**
   * Derive a vCluster name from a project name and git branch.
   *
   * @deprecated Use the standalone `nameFromContext` export instead.
   */
  static nameFromContext(projectName: string, branch: string): string {
    return nameFromContext(projectName, branch);
  }
}

/**
 * Derive a vCluster name from a project name and git branch.
 *
 * Rules:
 * - Lowercase
 * - Non-alphanumeric characters replaced with hyphens
 * - Consecutive hyphens collapsed
 * - Truncated to 63 characters (Kubernetes label value limit)
 */
export function nameFromContext(projectName: string, branch: string): string {
  return `${projectName}-${branch}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .substring(0, 63);
}
