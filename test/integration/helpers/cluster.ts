/**
 * Cluster prerequisite checks for integration tests.
 *
 * Verifies that the machine has the tools and infrastructure
 * needed to run real-cluster integration tests.
 */

import { execSync } from 'child_process';

export interface ClusterPrerequisites {
  docker: boolean;
  kubectl: boolean;
  helm: boolean;
  kind: boolean;
  k3s: boolean;
  clusterRunning: boolean;
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function isClusterReachable(): boolean {
  try {
    execSync('kubectl cluster-info', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check all prerequisites for integration testing.
 */
export function checkPrerequisites(): ClusterPrerequisites {
  return {
    docker: commandExists('docker'),
    kubectl: commandExists('kubectl'),
    helm: commandExists('helm'),
    kind: commandExists('kind'),
    k3s: commandExists('k3s'),
    clusterRunning: isClusterReachable(),
  };
}

/**
 * Returns true if minimum prerequisites are met:
 * docker, kubectl, helm, at least one of kind/k3s, and a reachable cluster.
 */
export function canRunIntegrationTests(): boolean {
  const prereqs = checkPrerequisites();
  return (
    prereqs.docker &&
    prereqs.kubectl &&
    prereqs.helm &&
    (prereqs.kind || prereqs.k3s) &&
    prereqs.clusterRunning
  );
}

/**
 * Format missing prerequisites as a human-readable skip reason.
 */
export function formatMissingPrerequisites(): string {
  const prereqs = checkPrerequisites();
  const missing: string[] = [];

  if (!prereqs.docker) missing.push('docker');
  if (!prereqs.kubectl) missing.push('kubectl');
  if (!prereqs.helm) missing.push('helm');
  if (!prereqs.kind && !prereqs.k3s) missing.push('kind or k3s');
  if (!prereqs.clusterRunning) missing.push('reachable cluster');

  return `Missing prerequisites: ${missing.join(', ')}`;
}
