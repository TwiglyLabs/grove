/**
 * Tests for the vCluster-based environment API.
 *
 * Tests orchestration logic: config detection, VCluster lifecycle,
 * and deployment sequencing. All external calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock instances shared across tests -----

const mockVClusterInstance = {
  exists: vi.fn().mockReturnValue(false),
  create: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  delete: vi.fn(),
};

const mockPlatformInstance = {
  isInstalled: vi.fn().mockReturnValue(false),
  install: vi.fn(),
  upgrade: vi.fn(),
  ensure: vi.fn(),
};

const mockDbInstance = {
  deployAll: vi.fn().mockResolvedValue(undefined),
};

const mockSvcInstance = {
  deployAll: vi.fn().mockResolvedValue(undefined),
};

// Mock modules before any imports that use them
vi.mock('./processes/VClusterManager.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function VClusterManager(this: any) {
    return mockVClusterInstance;
  }
  return {
    VClusterManager,
    nameFromContext: (project: string, branch: string) =>
      `${project}-${branch}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/--+/g, '-')
        .substring(0, 63),
  };
});

vi.mock('./processes/PlatformDeployer.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function PlatformDeployer(this: any) {
    return mockPlatformInstance;
  }
  return { PlatformDeployer };
});

vi.mock('./processes/DatabaseDeployer.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function DatabaseDeployer(this: any) {
    return mockDbInstance;
  }
  return { DatabaseDeployer };
});

vi.mock('./processes/ServiceDeployer.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function ServiceDeployer(this: any) {
    return mockSvcInstance;
  }
  return { ServiceDeployer };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('main\n'),
}));

import { execSync } from 'node:child_process';
import { vclusterUp, vclusterDown } from './vcluster-api.js';
import type { GroveEnvironmentConfig } from './vcluster-config.js';

const mockExecSync = vi.mocked(execSync);

function makeConfig(overrides: Partial<GroveEnvironmentConfig> = {}): GroveEnvironmentConfig {
  return {
    platform: { chart: 'oci://charts/platform' },
    databases: [],
    services: [],
    ...overrides,
  };
}

describe('vclusterUp()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('main\n');
    mockDbInstance.deployAll.mockResolvedValue(undefined);
    mockSvcInstance.deployAll.mockResolvedValue(undefined);
  });

  it('creates and connects to a vCluster', async () => {
    await vclusterUp('myapp', makeConfig());

    expect(mockVClusterInstance.create).toHaveBeenCalledWith(expect.stringContaining('myapp'));
    expect(mockVClusterInstance.connect).toHaveBeenCalledWith(expect.stringContaining('myapp'));
  });

  it('derives vCluster name from project and git branch', async () => {
    mockExecSync.mockReturnValue('feature/my-branch\n');

    await vclusterUp('myapp', makeConfig());

    expect(mockVClusterInstance.create).toHaveBeenCalledWith('myapp-feature-my-branch');
  });

  it('deploys the platform chart', async () => {
    await vclusterUp('myapp', makeConfig());

    expect(mockPlatformInstance.ensure).toHaveBeenCalledWith(
      expect.objectContaining({ chart: 'oci://charts/platform' }),
    );
  });

  it('deploys databases', async () => {
    const config = makeConfig({
      databases: [{ name: 'postgres', chart: 'oci://charts/postgres' }],
    });

    await vclusterUp('myapp', config);

    expect(mockDbInstance.deployAll).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'postgres' })]),
    );
  });

  it('deploys services', async () => {
    const config = makeConfig({
      services: [{ name: 'api', chart: 'oci://charts/api' }],
    });

    await vclusterUp('myapp', config);

    expect(mockSvcInstance.deployAll).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'api' })]),
      expect.objectContaining({}),
    );
  });

  it('passes --only filter to service deployer', async () => {
    const config = makeConfig({
      services: [
        { name: 'api', chart: 'oci://charts/api' },
        { name: 'worker', chart: 'oci://charts/worker' },
      ],
    });

    await vclusterUp('myapp', config, { only: ['api'] });

    expect(mockSvcInstance.deployAll).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ only: ['api'] }),
    );
  });

  it('returns the vCluster name', async () => {
    mockExecSync.mockReturnValue('main\n');
    const result = await vclusterUp('myapp', makeConfig());
    expect(result.clusterName).toBe('myapp-main');
  });
});

describe('vclusterDown()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('main\n');
  });

  it('disconnects from the vCluster', async () => {
    await vclusterDown('myapp');
    expect(mockVClusterInstance.disconnect).toHaveBeenCalled();
  });

  it('deletes the vCluster', async () => {
    await vclusterDown('myapp');
    expect(mockVClusterInstance.delete).toHaveBeenCalledWith(expect.stringContaining('myapp'));
  });

  it('returns the cluster name that was deleted', async () => {
    mockExecSync.mockReturnValue('main\n');
    const result = await vclusterDown('myapp');
    expect(result.clusterName).toBe('myapp-main');
  });
});
