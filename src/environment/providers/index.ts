import type { ClusterProvider, ClusterType } from '../types.js';
import { KindProvider } from './kind.js';
import { K3sProvider } from './k3s.js';

export function createClusterProvider(type: ClusterType): ClusterProvider {
  switch (type) {
    case 'kind':
      return new KindProvider();
    case 'k3s':
      return new K3sProvider();
  }
}

export { KindProvider } from './kind.js';
export { K3sProvider } from './k3s.js';
