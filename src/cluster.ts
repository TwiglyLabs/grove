import { execSync } from 'child_process';

export function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch (error) {
    throw new Error('Not in a git repository');
  }
}

export function getKindClusters(): string[] {
  try {
    const output = execSync('kind get clusters', { encoding: 'utf-8' }).trim();
    return output ? output.split('\n') : [];
  } catch (error) {
    return [];
  }
}

export function ensureCluster(clusterName: string = 'twiglylabs-local'): void {
  const clusters = getKindClusters();

  if (!clusters.includes(clusterName)) {
    console.log(`Creating kind cluster: ${clusterName}...`);
    execSync(`kind create cluster --name ${clusterName}`, { stdio: 'inherit' });
  }

  // Set kubectl context
  execSync(`kubectl config use-context kind-${clusterName}`, { stdio: 'inherit' });
}

export function deleteCluster(clusterName: string): void {
  const clusters = getKindClusters();

  if (clusters.includes(clusterName)) {
    console.log(`Deleting kind cluster: ${clusterName}...`);
    execSync(`kind delete cluster --name ${clusterName}`, { stdio: 'inherit' });
  }
}

export function ensureNamespace(namespace: string): void {
  try {
    execSync(`kubectl get namespace ${namespace}`, { stdio: 'pipe' });
  } catch {
    console.log(`Creating namespace: ${namespace}...`);
    execSync(`kubectl create namespace ${namespace}`, { stdio: 'inherit' });
  }
}
