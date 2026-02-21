import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClusterProvider, ClusterType } from './types.js';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
}));

import { ensureCluster, ensureNamespace } from './cluster.js';
import { printInfo } from '../shared/output.js';

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

describe('ensureCluster', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates cluster when it does not exist', () => {
    const provider = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(false),
    });

    ensureCluster(provider, 'my-cluster');

    expect(provider.clusterExists).toHaveBeenCalledWith('my-cluster');
    expect(provider.createCluster).toHaveBeenCalledWith('my-cluster');
  });

  it('skips create when cluster already exists', () => {
    const provider = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(true),
    });

    ensureCluster(provider, 'my-cluster');

    expect(provider.clusterExists).toHaveBeenCalledWith('my-cluster');
    expect(provider.createCluster).not.toHaveBeenCalled();
  });

  it('always sets context regardless of cluster existence', () => {
    const providerNew = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(false),
    });
    const providerExisting = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(true),
    });

    ensureCluster(providerNew, 'new-cluster');
    ensureCluster(providerExisting, 'existing-cluster');

    expect(providerNew.setContext).toHaveBeenCalledWith('new-cluster');
    expect(providerExisting.setContext).toHaveBeenCalledWith('existing-cluster');
  });

  it('prints info message when creating cluster', () => {
    const provider = createMockProvider({
      type: 'k3s',
      clusterExists: vi.fn().mockReturnValue(false),
    });

    ensureCluster(provider, 'my-cluster');

    expect(printInfo).toHaveBeenCalledWith('Creating k3s cluster: my-cluster...');
  });

  it('does not print when cluster already exists', () => {
    const provider = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(true),
    });

    ensureCluster(provider, 'my-cluster');

    expect(printInfo).not.toHaveBeenCalled();
  });
});

describe('ensureNamespace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not create namespace when it already exists', () => {
    mockExecSync.mockReturnValue('');

    ensureNamespace('my-namespace');

    expect(mockExecSync).toHaveBeenCalledWith(
      'kubectl get namespace my-namespace',
      { stdio: 'pipe' },
    );
    // Only the get call, no create
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('creates namespace when get fails', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('not found'); })
      .mockReturnValueOnce('');

    ensureNamespace('my-namespace');

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(1,
      'kubectl get namespace my-namespace',
      { stdio: 'pipe' },
    );
    expect(mockExecSync).toHaveBeenNthCalledWith(2,
      'kubectl create namespace my-namespace',
      { stdio: 'inherit' },
    );
  });

  it('prints info when creating namespace', () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('not found'); });

    ensureNamespace('my-namespace');

    expect(printInfo).toHaveBeenCalledWith('Creating namespace: my-namespace...');
  });

  it('propagates error when kubectl create namespace fails', () => {
    mockExecSync
      .mockImplementationOnce(() => { throw new Error('not found'); })
      .mockImplementationOnce(() => { throw new Error('forbidden: insufficient permissions'); });

    expect(() => ensureNamespace('my-namespace')).toThrow('forbidden: insufficient permissions');
  });
});

describe('ensureCluster — error propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates error when createCluster fails', () => {
    const provider = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(false),
      createCluster: vi.fn(() => { throw new Error('kind: docker not running'); }),
    });

    expect(() => ensureCluster(provider, 'my-cluster')).toThrow('kind: docker not running');
  });

  it('propagates error when setContext fails', () => {
    const provider = createMockProvider({
      clusterExists: vi.fn().mockReturnValue(true),
      setContext: vi.fn(() => { throw new Error('context switch failed'); }),
    });

    expect(() => ensureCluster(provider, 'my-cluster')).toThrow('context switch failed');
  });
});
