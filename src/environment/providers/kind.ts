import { execSync } from 'child_process';
import type { ClusterProvider } from '../types.js';

export class KindProvider implements ClusterProvider {
  readonly type = 'kind' as const;

  clusterExists(name: string): boolean {
    try {
      const output = execSync('kind get clusters', { encoding: 'utf-8' }).trim();
      const clusters = output ? output.split('\n') : [];
      return clusters.includes(name);
    } catch {
      return false;
    }
  }

  createCluster(name: string): void {
    execSync(`kind create cluster --name ${name}`, { stdio: 'inherit' });
  }

  deleteCluster(name: string): void {
    execSync(`kind delete cluster --name ${name}`, { stdio: 'inherit' });
  }

  setContext(name: string): void {
    execSync(`kubectl config use-context kind-${name}`, { stdio: 'inherit' });
  }

  loadImage(image: string, clusterName: string): void {
    execSync(`kind load docker-image ${image} --name ${clusterName}`, { stdio: 'inherit' });
  }
}
