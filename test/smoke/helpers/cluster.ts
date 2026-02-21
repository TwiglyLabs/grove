import { execSync } from 'node:child_process';

export function ensureSmokeCluster(name: string): void {
  if (clusterExists(name)) {
    console.log(`Cluster ${name} already exists, reusing`);
    return;
  }
  console.log(`Creating k3d cluster ${name}...`);
  execSync(`k3d cluster create ${name} --no-lb --wait`, { stdio: 'inherit' });
}

export function deleteSmokeCluster(name: string): void {
  if (!clusterExists(name)) return;
  console.log(`Deleting k3d cluster ${name}...`);
  execSync(`k3d cluster delete ${name}`, { stdio: 'inherit' });
}

function clusterExists(name: string): boolean {
  try {
    const output = execSync(`k3d cluster list -o json`, { stdio: 'pipe' }).toString();
    const clusters = JSON.parse(output);
    return clusters.some((c: { name: string }) => c.name === name);
  } catch {
    return false;
  }
}

export function createNamespace(name: string): void {
  try {
    execSync(`kubectl create namespace ${name}`, { stdio: 'pipe' });
  } catch {
    // Namespace may already exist
  }
}

export function deleteNamespace(name: string): void {
  try {
    execSync(`kubectl delete namespace ${name} --ignore-not-found`, { stdio: 'pipe' });
  } catch {
    // Best effort
  }
}
