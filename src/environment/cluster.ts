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
 * Ensure a Kubernetes namespace exists and is labeled for Helm ownership.
 * Provider-independent (uses kubectl).
 *
 * Labels and annotations are applied idempotently (--overwrite) so Helm
 * can adopt the namespace whether it was just created or already existed.
 */
export function ensureNamespace(namespace: string, helmRelease: string): void {
  try {
    execSync(`kubectl get namespace ${namespace}`, { stdio: 'pipe' });
  } catch {
    printInfo(`Creating namespace: ${namespace}...`);
    execSync(`kubectl create namespace ${namespace}`, { stdio: 'inherit' });
  }

  // Label and annotate for Helm ownership so helm upgrade --install can adopt the namespace
  execSync(`kubectl label namespace ${namespace} app.kubernetes.io/managed-by=Helm --overwrite`, { stdio: 'pipe' });
  execSync(`kubectl annotate namespace ${namespace} meta.helm.sh/release-name=${helmRelease} meta.helm.sh/release-namespace=${namespace} --overwrite`, { stdio: 'pipe' });
}
