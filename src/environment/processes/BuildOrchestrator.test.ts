import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClusterProvider, ClusterType, EnvironmentState } from '../types.js';
import type { GroveConfig, Service } from '../../config.js';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('../../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
}));

import { BuildOrchestrator } from './BuildOrchestrator.js';
import { printInfo, printSuccess } from '../../shared/output.js';

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
    project: { name: 'test-app', cluster: 'test-cluster', clusterType: 'kind' },
    repoRoot: '/tmp/test-repo',
    services: [],
    helm: { chart: './chart', release: 'test', valuesFiles: ['values.yaml'] },
    portBlockSize: 5,
    ...overrides,
  } as GroveConfig;
}

function makeState(): EnvironmentState {
  return {
    namespace: 'test-app-main',
    branch: 'main',
    worktreeId: 'main',
    ports: {},
    urls: {},
    processes: {},
    lastEnsure: new Date().toISOString(),
  };
}

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    name: 'api',
    build: {
      image: 'api:latest',
      dockerfile: 'services/api/Dockerfile',
    },
    ...overrides,
  } as Service;
}

describe('BuildOrchestrator', () => {
  let provider: ClusterProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createMockProvider();
  });

  describe('loadImage', () => {
    it('delegates to provider.loadImage with image and cluster name', () => {
      const config = makeConfig();
      const orchestrator = new BuildOrchestrator(config, makeState(), provider);
      const service = makeService();

      orchestrator.loadImage(service);

      expect(provider.loadImage).toHaveBeenCalledWith('api:latest', 'test-cluster');
    });

    it('skips when service has no build config', () => {
      const orchestrator = new BuildOrchestrator(makeConfig(), makeState(), provider);
      const service = makeService({ build: undefined });

      orchestrator.loadImage(service);

      expect(provider.loadImage).not.toHaveBeenCalled();
    });

    it('prints provider type in info message', () => {
      const k3sProvider = createMockProvider({ type: 'k3s' });
      const orchestrator = new BuildOrchestrator(makeConfig(), makeState(), k3sProvider);
      const service = makeService();

      orchestrator.loadImage(service);

      expect(printInfo).toHaveBeenCalledWith('Loading api image to k3s...');
      expect(printSuccess).toHaveBeenCalledWith('Loaded api to k3s');
    });

    it('throws descriptive error on failure', () => {
      const failingProvider = createMockProvider({
        loadImage: vi.fn().mockImplementation(() => { throw new Error('load failed'); }),
      });
      const orchestrator = new BuildOrchestrator(makeConfig(), makeState(), failingProvider);
      const service = makeService();

      expect(() => orchestrator.loadImage(service)).toThrow('Failed to load api to kind');
    });
  });

  describe('loadAllImages', () => {
    it('loads images for all services with build config', () => {
      const config = makeConfig({
        services: [
          makeService({ name: 'api', build: { image: 'api:latest', dockerfile: 'Dockerfile.api' } }),
          makeService({ name: 'worker', build: { image: 'worker:latest', dockerfile: 'Dockerfile.worker' } }),
          makeService({ name: 'redis', build: undefined }),
        ],
      });
      const orchestrator = new BuildOrchestrator(config, makeState(), provider);

      orchestrator.loadAllImages();

      expect(provider.loadImage).toHaveBeenCalledTimes(2);
      expect(provider.loadImage).toHaveBeenCalledWith('api:latest', 'test-cluster');
      expect(provider.loadImage).toHaveBeenCalledWith('worker:latest', 'test-cluster');
    });
  });

  describe('buildService', () => {
    it('runs docker build command', () => {
      const orchestrator = new BuildOrchestrator(makeConfig(), makeState(), provider);
      const service = makeService();

      orchestrator.buildService(service);

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker build -t api:latest'),
        { stdio: 'inherit' },
      );
    });

    it('skips when service has no build config', () => {
      const orchestrator = new BuildOrchestrator(makeConfig(), makeState(), provider);
      const service = makeService({ build: undefined });

      orchestrator.buildService(service);

      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });

  describe('helmUpgrade', () => {
    it('runs helm upgrade command with namespace from state', () => {
      const orchestrator = new BuildOrchestrator(makeConfig(), makeState(), provider);

      orchestrator.helmUpgrade();

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-n test-app-main'),
        { stdio: 'inherit' },
      );
    });
  });

  describe('buildAndDeploy', () => {
    it('builds, loads images, and runs helm upgrade', async () => {
      const config = makeConfig({
        services: [makeService()],
      });
      const orchestrator = new BuildOrchestrator(config, makeState(), provider);

      await orchestrator.buildAndDeploy();

      // docker build called
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker build'),
        expect.any(Object),
      );
      // provider.loadImage called
      expect(provider.loadImage).toHaveBeenCalled();
      // helm upgrade called
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('helm upgrade'),
        expect.any(Object),
      );
    });
  });
});
