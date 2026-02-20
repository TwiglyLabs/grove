import { execSync } from 'child_process';

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

export function ensureNamespace(namespace: string): void {
  try {
    execSync(`kubectl get namespace ${namespace}`, { stdio: 'pipe' });
  } catch {
    console.log(`Creating namespace: ${namespace}...`);
    execSync(`kubectl create namespace ${namespace}`, { stdio: 'inherit' });
  }
}
