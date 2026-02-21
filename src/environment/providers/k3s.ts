import { execSync } from 'child_process';
import type { ClusterProvider } from '../types.js';

export class K3sProvider implements ClusterProvider {
  readonly type = 'k3s' as const;

  clusterExists(name: string): boolean {
    try {
      const output = execSync('k3d cluster list -o json', { encoding: 'utf-8' });
      const clusters = JSON.parse(output) as Array<{ name: string }>;
      return clusters.some(c => c.name === name);
    } catch {
      return false;
    }
  }

  createCluster(name: string): void {
    execSync(`k3d cluster create ${name}`, { stdio: 'inherit' });
  }

  deleteCluster(name: string): void {
    execSync(`k3d cluster delete ${name}`, { stdio: 'inherit' });
  }

  setContext(name: string): void {
    execSync(`kubectl config use-context k3d-${name}`, { stdio: 'inherit' });
  }

  loadImage(image: string, clusterName: string): void {
    execSync(`k3d image import ${image} --cluster ${clusterName}`, { stdio: 'inherit' });
  }
}
