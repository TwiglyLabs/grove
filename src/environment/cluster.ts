import { execSync } from 'child_process';
import type { ClusterProvider } from './types.js';
import { printInfo } from '../shared/output.js';

/**
 * Ensure a cluster exists and kubectl context is set.
 * Uses the provider abstraction — works with kind, k3s, etc.
 */
export function ensureCluster(provider: ClusterProvider, clusterName: string): void {
  if (!provider.clusterExists(clusterName)) {
    printInfo(`Creating ${provider.type} cluster: ${clusterName}...`);
    provider.createCluster(clusterName);
  }

  provider.setContext(clusterName);
}

/**
 * Ensure a Kubernetes namespace exists. Provider-independent (uses kubectl).
 */
export function ensureNamespace(namespace: string): void {
  try {
    execSync(`kubectl get namespace ${namespace}`, { stdio: 'pipe' });
  } catch {
    printInfo(`Creating namespace: ${namespace}...`);
    execSync(`kubectl create namespace ${namespace}`, { stdio: 'inherit' });
  }
}
