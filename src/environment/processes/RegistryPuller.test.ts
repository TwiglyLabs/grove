import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClusterProvider, ClusterType } from '../types.js';
import type { GroveConfig, Service } from '../../config.js';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}));

import { RegistryPuller } from './RegistryPuller.js';
import { printInfo, printWarning } from '../../shared/output.js';
import { RegistryPullFailedError } from '../../shared/errors.js';

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

function makeConfig(overrides: Partial<GroveConfig> = {}): GroveConfig {
  return {
    project: {
      name: 'test-app',
      cluster: 'test-cluster',
      clusterType: 'kind',
      registry: 'us-central1-docker.pkg.dev/twiglylabs/acorn',
    },
    repoRoot: '/tmp/test-repo',
    services: [
      { name: 'api', build: { image: 'api:latest', dockerfile: 'services/api/Dockerfile' } },
      { name: 'worker', build: { image: 'worker:latest', dockerfile: 'services/worker/Dockerfile' } },
      { name: 'redis' }, // no build — pre-built
    ] as Service[],
    helm: { chart: './chart', release: 'test', valuesFiles: ['values.yaml'] },
    portBlockSize: 5,
    ...overrides,
  } as GroveConfig;
}

describe('RegistryPuller', () => {
  let provider: ClusterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createMockProvider();
    // Default: docker image inspect fails (image doesn't exist locally)
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.startsWith('docker image inspect')) {
        throw new Error('No such image');
      }
      return '';
    });
  });

  it('throws when no registry is configured', () => {
    const config = makeConfig({
      project: { name: 'test-app', cluster: 'test-cluster', clusterType: 'kind' },
    });

    expect(() => new RegistryPuller(config, provider)).toThrow(RegistryPullFailedError);
  });

  describe('pullAndLoad', () => {
    it('pulls from registry, re-tags, and loads into cluster', () => {
      const puller = new RegistryPuller(makeConfig(), provider);

      puller.pullAndLoad('api', 'api:latest');

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker pull us-central1-docker.pkg.dev/twiglylabs/acorn/api:latest',
        { stdio: 'inherit' },
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker tag us-central1-docker.pkg.dev/twiglylabs/acorn/api:latest api:latest',
        { stdio: 'inherit' },
      );
      expect(provider.loadImage).toHaveBeenCalledWith('api:latest', 'test-cluster');
    });

    it('skips pull when image exists locally (smart pull)', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('docker image inspect')) {
          return ''; // image exists
        }
        return '';
      });

      const puller = new RegistryPuller(makeConfig(), provider);

      puller.pullAndLoad('api', 'api:latest');

      expect(printInfo).toHaveBeenCalledWith('Skipping api — image already exists locally');
      expect(provider.loadImage).not.toHaveBeenCalled();
    });

    it('forces pull with forcePull even when image exists locally', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('docker image inspect')) {
          return ''; // image exists
        }
        return '';
      });

      const puller = new RegistryPuller(makeConfig(), provider);

      puller.pullAndLoad('api', 'api:latest', { forcePull: true });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker pull'),
        { stdio: 'inherit' },
      );
      expect(provider.loadImage).toHaveBeenCalled();
    });

    it('throws RegistryPullFailedError on pull failure', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('docker image inspect')) {
          throw new Error('No such image');
        }
        if (cmd.startsWith('docker pull')) {
          throw new Error('network error');
        }
        return '';
      });

      const puller = new RegistryPuller(makeConfig(), provider);

      expect(() => puller.pullAndLoad('api', 'api:latest')).toThrow(RegistryPullFailedError);
    });
  });

  describe('pullAllNonDev', () => {
    it('pulls all services except dev services', () => {
      const puller = new RegistryPuller(makeConfig(), provider);

      puller.pullAllNonDev(['api']);

      // Should pull worker but not api (dev) or redis (no build)
      const pullCalls = mockExecSync.mock.calls
        .filter(([cmd]: [string]) => typeof cmd === 'string' && cmd.startsWith('docker pull'))
        .map(([cmd]: [string]) => cmd);

      expect(pullCalls).toHaveLength(1);
      expect(pullCalls[0]).toContain('worker:latest');
    });

    it('skips services without build config', () => {
      const puller = new RegistryPuller(makeConfig(), provider);

      puller.pullAllNonDev([]);

      // Should pull api and worker, but not redis (no build)
      const pullCalls = mockExecSync.mock.calls
        .filter(([cmd]: [string]) => typeof cmd === 'string' && cmd.startsWith('docker pull'))
        .map(([cmd]: [string]) => cmd);

      expect(pullCalls).toHaveLength(2);
    });

    it('continues on pull failure (non-fatal)', () => {
      let pullCount = 0;
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('docker image inspect')) {
          throw new Error('No such image');
        }
        if (cmd.startsWith('docker pull')) {
          pullCount++;
          if (pullCount === 1) {
            throw new Error('network error');
          }
        }
        return '';
      });

      const puller = new RegistryPuller(makeConfig(), provider);

      // Should not throw
      puller.pullAllNonDev([]);

      expect(printWarning).toHaveBeenCalledWith(expect.stringContaining('continuing'));
    });

    it('passes forcePull option through', () => {
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.startsWith('docker image inspect')) {
          return ''; // image exists locally
        }
        return '';
      });

      const puller = new RegistryPuller(makeConfig(), provider);

      puller.pullAllNonDev(['api'], { forcePull: true });

      // Should still pull worker despite it existing locally
      const pullCalls = mockExecSync.mock.calls
        .filter(([cmd]: [string]) => typeof cmd === 'string' && cmd.startsWith('docker pull'));

      expect(pullCalls).toHaveLength(1);
    });
  });
});
