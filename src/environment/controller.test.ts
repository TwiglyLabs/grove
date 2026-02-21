import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printError: vi.fn(),
  printSection: vi.fn(),
}));

vi.mock('./providers/index.js', () => ({
  createClusterProvider: vi.fn(() => ({
    type: 'kind',
    clusterExists: vi.fn(() => true),
    setContext: vi.fn(),
  })),
}));

vi.mock('./cluster.js', () => ({
  ensureCluster: vi.fn(),
  ensureNamespace: vi.fn(),
}));

vi.mock('./preflight.js', () => ({
  runPreflightChecks: vi.fn(),
}));

vi.mock('./bootstrap.js', () => ({
  runBootstrapChecks: vi.fn(),
}));

const mockWriteState = vi.fn();
vi.mock('./state.js', () => ({
  loadOrCreateState: vi.fn(() => ({
    namespace: 'test-ns',
    branch: 'main',
    worktreeId: 'main',
    ports: { api: 10000, worker: 10001, web: 10002 },
    urls: { api: 'http://127.0.0.1:10000', worker: 'http://127.0.0.1:10001', web: 'http://127.0.0.1:10002' },
    processes: {},
    lastEnsure: new Date().toISOString(),
  })),
  writeState: mockWriteState,
}));

vi.mock('./processes/BuildOrchestrator.js', () => ({
  BuildOrchestrator: class {
    async buildAndDeploy() {}
  },
}));

// Controllable PortForwardProcess mock
const mockPortForwardStart = vi.fn(async () => ({ pid: 1234, startedAt: new Date().toISOString() }));
vi.mock('./processes/PortForwardProcess.js', () => ({
  PortForwardProcess: class {
    constructor(public opts: unknown) {}
    start = mockPortForwardStart;
  },
}));

// Controllable GenericDevServer mock
const mockDevServerStart = vi.fn(async () => ({ pid: 5678, startedAt: new Date().toISOString() }));
vi.mock('./frontends/GenericDevServer.js', () => ({
  GenericDevServer: class {
    constructor(public config: unknown, public port: unknown) {}
    start = mockDevServerStart;
  },
}));

vi.mock('./health.js', () => ({
  waitForHealth: vi.fn(),
  waitForHealthResult: vi.fn(() => ({
    target: 'api',
    healthy: true,
    protocol: 'http',
    port: 10000,
    attempts: 1,
    elapsedMs: 100,
  })),
}));

vi.mock('./processes/PortForwardSupervisor.js', () => ({
  PortForwardSupervisor: class {
    register() {}
    start() {}
    async stop() {}
  },
}));

vi.mock('./timing.js', () => ({
  Timer: class {
    elapsed() { return 1000; }
    format() { return '1.0s'; }
  },
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import type { GroveConfig } from '../config.js';
import { ensureCluster, ensureNamespace } from './cluster.js';

const { ensureEnvironment } = await import('./controller.js');

function makeConfig(overrides: Partial<GroveConfig> = {}): GroveConfig {
  return {
    repoRoot: '/tmp/test-repo',
    portBlockSize: 10,
    project: {
      name: 'test',
      cluster: 'test-cluster',
      clusterType: 'kind',
    },
    helm: {
      chart: './chart',
      release: 'test',
      valuesFiles: ['values.yaml'],
    },
    services: [
      {
        name: 'api',
        portForward: { remotePort: 3000 },
        health: { protocol: 'http', path: '/health' },
      },
    ],
    frontends: [
      {
        name: 'web',
        path: './web',
        devCommand: 'npm run dev',
        health: { protocol: 'http', path: '/' },
      },
    ],
    ...overrides,
  } as GroveConfig;
}

function makeMultiServiceConfig(): GroveConfig {
  return makeConfig({
    services: [
      {
        name: 'api',
        portForward: { remotePort: 3000 },
        health: { protocol: 'http', path: '/health' },
      },
      {
        name: 'worker',
        portForward: { remotePort: 4000 },
        health: { protocol: 'http', path: '/health' },
      },
    ] as GroveConfig['services'],
  });
}

describe('ensureEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPortForwardStart.mockResolvedValue({ pid: 1234, startedAt: new Date().toISOString() });
    mockDevServerStart.mockResolvedValue({ pid: 5678, startedAt: new Date().toISOString() });
  });

  describe('incremental state writes', () => {
    it('calls writeState after startPortForwards and after startFrontends', async () => {
      const config = makeConfig();

      await ensureEnvironment(config, { all: true });

      // writeState should be called 3 times:
      // 1. after startPortForwards
      // 2. after startFrontends
      // 3. final save at end
      expect(mockWriteState).toHaveBeenCalledTimes(3);
    });

    it('persists port-forward PIDs before starting frontends', async () => {
      const config = makeConfig();
      const writeStateCalls: Array<{ processes: Record<string, unknown> }> = [];

      mockWriteState.mockImplementation((state: { processes: Record<string, unknown> }) => {
        writeStateCalls.push({ processes: { ...state.processes } });
      });

      await ensureEnvironment(config, { all: true });

      // First writeState call should have port-forward process
      expect(writeStateCalls[0].processes['port-forward-api']).toBeDefined();
    });

    it('still calls final writeState for lastEnsure and supervisor state', async () => {
      const config = makeConfig();

      await ensureEnvironment(config, { all: true });

      const lastCall = mockWriteState.mock.calls[mockWriteState.mock.calls.length - 1];
      expect(lastCall).toBeDefined();
    });

    it('calls writeState three times even when no frontends configured', async () => {
      const config = makeConfig({ frontends: [] });

      await ensureEnvironment(config);

      expect(mockWriteState).toHaveBeenCalledTimes(3);
    });
  });

  describe('partial failure rollback', () => {
    it('kills already-started port-forwards when a later port-forward fails', async () => {
      const config = makeMultiServiceConfig();
      let callCount = 0;

      // First service starts OK, second fails
      mockPortForwardStart.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('port-forward failed for worker');
        }
        return { pid: 1234, startedAt: new Date().toISOString() };
      });

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await expect(ensureEnvironment(config)).rejects.toThrow('port-forward failed for worker');

        // Should have tried to kill the first service's process
        expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM');
      } finally {
        killSpy.mockRestore();
      }
    });

    it('cleans state.processes on port-forward failure', async () => {
      const config = makeMultiServiceConfig();
      let callCount = 0;

      mockPortForwardStart.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('port-forward failed');
        }
        return { pid: 1234, startedAt: new Date().toISOString() };
      });

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await expect(ensureEnvironment(config)).rejects.toThrow();

        // writeState should be called with cleaned processes
        const lastWriteCall = mockWriteState.mock.calls[mockWriteState.mock.calls.length - 1];
        const writtenState = lastWriteCall[0] as { processes: Record<string, unknown> };
        expect(Object.keys(writtenState.processes)).toHaveLength(0);
      } finally {
        killSpy.mockRestore();
      }
    });

    it('kills all processes when frontend start fails', async () => {
      const config = makeConfig();

      mockDevServerStart.mockRejectedValue(new Error('frontend failed'));

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await expect(ensureEnvironment(config, { all: true })).rejects.toThrow('frontend failed');

        // Should have killed the port-forward process
        expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM');
      } finally {
        killSpy.mockRestore();
      }
    });

    it('writes cleaned state before re-throwing on frontend failure', async () => {
      const config = makeConfig();

      mockDevServerStart.mockRejectedValue(new Error('frontend failed'));

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await expect(ensureEnvironment(config, { all: true })).rejects.toThrow('frontend failed');

        // Last writeState call should have empty processes
        const lastWriteCall = mockWriteState.mock.calls[mockWriteState.mock.calls.length - 1];
        const writtenState = lastWriteCall[0] as { processes: Record<string, unknown> };
        expect(Object.keys(writtenState.processes)).toHaveLength(0);
      } finally {
        killSpy.mockRestore();
      }
    });

    it('propagates the original error after rollback', async () => {
      const config = makeConfig();

      mockPortForwardStart.mockRejectedValue(new Error('connection refused'));

      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await expect(ensureEnvironment(config)).rejects.toThrow('connection refused');
      } finally {
        killSpy.mockRestore();
      }
    });
  });

  describe('cluster and namespace error surfacing', () => {
    it('propagates ensureCluster failure', async () => {
      const config = makeConfig();

      vi.mocked(ensureCluster).mockImplementation(() => {
        throw new Error('cluster creation failed: kind not found');
      });

      await expect(ensureEnvironment(config)).rejects.toThrow('cluster creation failed');
    });

    it('propagates ensureNamespace failure', async () => {
      const config = makeConfig();

      vi.mocked(ensureCluster).mockImplementation(() => {});
      vi.mocked(ensureNamespace).mockImplementation(() => {
        throw new Error('kubectl create namespace failed');
      });

      await expect(ensureEnvironment(config)).rejects.toThrow('kubectl create namespace failed');
    });
  });
});
