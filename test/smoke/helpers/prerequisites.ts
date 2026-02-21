import { execSync } from 'node:child_process';

export interface SmokePrerequisites {
  docker: boolean;
  kubectl: boolean;
  helm: boolean;
  k3d: boolean;
  colima: boolean;
  clusterReachable: boolean;
}

function commandExists(command: string): boolean {
  try {
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function checkSmokePrerequisites(): SmokePrerequisites {
  return {
    docker: commandExists('docker info'),
    kubectl: commandExists('kubectl version --client'),
    helm: commandExists('helm version --short'),
    k3d: commandExists('k3d version'),
    colima: commandExists('colima status'),
    clusterReachable: commandExists('kubectl cluster-info'),
  };
}

export function canRunSmokeTests(): boolean {
  const prereqs = checkSmokePrerequisites();
  return prereqs.docker && prereqs.kubectl && prereqs.helm && prereqs.k3d;
}

export function formatMissingSmokePrerequisites(): string {
  const prereqs = checkSmokePrerequisites();
  const missing: string[] = [];
  if (!prereqs.docker) missing.push('docker (is Colima or Docker Desktop running?)');
  if (!prereqs.kubectl) missing.push('kubectl');
  if (!prereqs.helm) missing.push('helm');
  if (!prereqs.k3d) missing.push('k3d');
  if (!prereqs.colima) missing.push('colima (optional — using Docker Desktop?)');
  if (!prereqs.clusterReachable) missing.push('cluster not reachable (run k3d cluster create)');

  if (missing.length === 0) return '';
  return `Missing smoke test prerequisites:\n${missing.map(m => `  - ${m}`).join('\n')}`;
}
