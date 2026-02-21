import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClusterProvider, ClusterType } from '../types.js';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { KindProvider } from './kind.js';
import { K3sProvider } from './k3s.js';
import { createClusterProvider } from './index.js';

// --- Mock provider for integration-style tests ---

function createMockProvider(overrides: Partial<ClusterProvider> = {}): ClusterProvider {
  return {
    type: 'kind' as ClusterType,
    createCluster: vi.fn(),
    deleteCluster: vi.fn(),
    clusterExists: vi.fn().mockReturnValue(false),
    setContext: vi.fn(),
    loadImage: vi.fn(),
    ...overrides,
  };
}

describe('KindProvider', () => {
  let provider: KindProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    provider = new KindProvider();
  });

  it('has type "kind"', () => {
    expect(provider.type).toBe('kind');
  });

  describe('clusterExists', () => {
    it('returns true when cluster is in kind list', () => {
      mockExecSync.mockReturnValue('my-cluster\nother-cluster\n');

      expect(provider.clusterExists('my-cluster')).toBe(true);
    });

    it('returns false when cluster is not in kind list', () => {
      mockExecSync.mockReturnValue('other-cluster\n');

      expect(provider.clusterExists('my-cluster')).toBe(false);
    });

    it('returns false when kind command fails', () => {
      mockExecSync.mockImplementation(() => { throw new Error('kind not found'); });

      expect(provider.clusterExists('my-cluster')).toBe(false);
    });

    it('returns false when no clusters exist', () => {
      mockExecSync.mockReturnValue('');

      expect(provider.clusterExists('my-cluster')).toBe(false);
    });
  });

  describe('createCluster', () => {
    it('calls kind create cluster with the name', () => {
      provider.createCluster('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kind create cluster --name my-cluster',
        { stdio: 'inherit' },
      );
    });
  });

  describe('deleteCluster', () => {
    it('calls kind delete cluster with the name', () => {
      provider.deleteCluster('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kind delete cluster --name my-cluster',
        { stdio: 'inherit' },
      );
    });
  });

  describe('setContext', () => {
    it('sets kubectl context with kind- prefix', () => {
      provider.setContext('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kubectl config use-context kind-my-cluster',
        { stdio: 'inherit' },
      );
    });
  });

  describe('loadImage', () => {
    it('calls kind load docker-image', () => {
      provider.loadImage('my-app:latest', 'my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kind load docker-image my-app:latest --name my-cluster',
        { stdio: 'inherit' },
      );
    });
  });
});

describe('K3sProvider', () => {
  let provider: K3sProvider;

  beforeEach(() => {
    vi.resetAllMocks();
    provider = new K3sProvider();
  });

  it('has type "k3s"', () => {
    expect(provider.type).toBe('k3s');
  });

  describe('clusterExists', () => {
    it('returns true when cluster is in k3d list', () => {
      mockExecSync.mockReturnValue(JSON.stringify([
        { name: 'my-cluster' },
        { name: 'other-cluster' },
      ]));

      expect(provider.clusterExists('my-cluster')).toBe(true);
    });

    it('returns false when cluster is not in k3d list', () => {
      mockExecSync.mockReturnValue(JSON.stringify([
        { name: 'other-cluster' },
      ]));

      expect(provider.clusterExists('my-cluster')).toBe(false);
    });

    it('returns false when k3d command fails', () => {
      mockExecSync.mockImplementation(() => { throw new Error('k3d not found'); });

      expect(provider.clusterExists('my-cluster')).toBe(false);
    });

    it('returns false when k3d returns empty array', () => {
      mockExecSync.mockReturnValue(JSON.stringify([]));

      expect(provider.clusterExists('my-cluster')).toBe(false);
    });
  });

  describe('createCluster', () => {
    it('calls k3d cluster create', () => {
      provider.createCluster('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'k3d cluster create my-cluster',
        { stdio: 'inherit' },
      );
    });
  });

  describe('deleteCluster', () => {
    it('calls k3d cluster delete', () => {
      provider.deleteCluster('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'k3d cluster delete my-cluster',
        { stdio: 'inherit' },
      );
    });
  });

  describe('setContext', () => {
    it('sets kubectl context with k3d- prefix', () => {
      provider.setContext('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kubectl config use-context k3d-my-cluster',
        { stdio: 'inherit' },
      );
    });
  });

  describe('loadImage', () => {
    it('calls k3d image import', () => {
      provider.loadImage('my-app:latest', 'my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'k3d image import my-app:latest --cluster my-cluster',
        { stdio: 'inherit' },
      );
    });
  });
});

describe('createClusterProvider', () => {
  it('returns KindProvider for "kind"', () => {
    const provider = createClusterProvider('kind');
    expect(provider).toBeInstanceOf(KindProvider);
    expect(provider.type).toBe('kind');
  });

  it('returns K3sProvider for "k3s"', () => {
    const provider = createClusterProvider('k3s');
    expect(provider).toBeInstanceOf(K3sProvider);
    expect(provider.type).toBe('k3s');
  });
});

describe('mock provider integration', () => {
  it('can be used as a ClusterProvider', () => {
    const mock = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(true),
    });

    expect(mock.clusterExists('test')).toBe(true);
    expect(mock.clusterExists).toHaveBeenCalledWith('test');
  });

  it('ensureCluster flow works with mock provider', async () => {
    const mock = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(false),
    });

    // Simulate ensureCluster logic
    if (!mock.clusterExists('test-cluster')) {
      mock.createCluster('test-cluster');
    }
    mock.setContext('test-cluster');

    expect(mock.createCluster).toHaveBeenCalledWith('test-cluster');
    expect(mock.setContext).toHaveBeenCalledWith('test-cluster');
  });

  it('skips create when cluster already exists', () => {
    const mock = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(true),
    });

    if (!mock.clusterExists('test-cluster')) {
      mock.createCluster('test-cluster');
    }
    mock.setContext('test-cluster');

    expect(mock.createCluster).not.toHaveBeenCalled();
    expect(mock.setContext).toHaveBeenCalledWith('test-cluster');
  });
});
