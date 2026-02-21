import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroveConfig, Service } from '../config.js';
import type { EnvironmentEvents, EnvironmentState } from './types.js';

// Mock chokidar before importing FileWatcher
vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
  })),
}));

vi.mock('./providers/index.js', () => ({
  createClusterProvider: vi.fn(() => ({})),
}));

// Track calls via module-level variables
let buildServiceFn: ReturnType<typeof vi.fn>;
let loadImageFn: ReturnType<typeof vi.fn>;
let helmUpgradeFn: ReturnType<typeof vi.fn>;

vi.mock('./processes/BuildOrchestrator.js', () => ({
  BuildOrchestrator: class MockBuildOrchestrator {
    constructor() {}
    buildService(...args: unknown[]) { return buildServiceFn(...args); }
    loadImage(...args: unknown[]) { return loadImageFn(...args); }
    helmUpgrade(...args: unknown[]) { return helmUpgradeFn(...args); }
  },
}));

const mockWaitForHealth = vi.fn();
vi.mock('./health.js', () => ({
  waitForHealth: (...args: unknown[]) => mockWaitForHealth(...args),
}));

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printError: vi.fn(),
}));

import { FileWatcher } from './watcher.js';

function makeConfig(): GroveConfig {
  return {
    project: { name: 'test-app', cluster: 'test-cluster', clusterType: 'kind' },
    repoRoot: '/tmp/test-repo',
    services: [
      {
        name: 'api',
        build: { image: 'api:latest', dockerfile: 'Dockerfile', watchPaths: ['src/'] },
        portForward: { remotePort: 3000 },
        health: { path: '/health', protocol: 'http' },
      },
    ],
    helm: { chart: './chart', release: 'test', valuesFiles: ['values.yaml'] },
    portBlockSize: 2,
  } as GroveConfig;
}

function makeState(): EnvironmentState {
  return {
    namespace: 'test-app-main',
    branch: 'main',
    worktreeId: 'main',
    ports: { api: 10000 },
    urls: { api: 'http://127.0.0.1:10000' },
    processes: {},
    lastEnsure: new Date().toISOString(),
  };
}

function makeService(): Service {
  return {
    name: 'api',
    build: { image: 'api:latest', dockerfile: 'Dockerfile', watchPaths: ['src/'] },
    portForward: { remotePort: 3000 },
    health: { path: '/health', protocol: 'http' },
  } as Service;
}

const instantOptions = { maxRebuildAttempts: 3, baseRetryDelayMs: 0 };

describe('FileWatcher rebuild retry logic', () => {
  beforeEach(() => {
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockWaitForHealth.mockReset();
    mockWaitForHealth.mockResolvedValue(true);
  });

  it('succeeds on first attempt with no retry', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
      onHealthCheck: vi.fn(),
    };
    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    await (watcher as any).rebuild(makeService());

    expect(buildServiceFn).toHaveBeenCalledTimes(1);
    expect(loadImageFn).toHaveBeenCalledTimes(1);
    expect(helmUpgradeFn).toHaveBeenCalledTimes(1);
    expect(events.onRebuild).toHaveBeenCalledWith('api', 'start');
    expect(events.onRebuild).toHaveBeenCalledWith('api', 'complete');
    expect(events.onHealthCheck).toHaveBeenCalledWith('api', true);
  });

  it('retries and succeeds on second attempt', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
      onError: vi.fn(),
    };

    buildServiceFn = vi.fn()
      .mockImplementationOnce(() => { throw new Error('temporary failure'); })
      .mockImplementation(() => {});

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    await (watcher as any).rebuild(makeService());

    expect(buildServiceFn).toHaveBeenCalledTimes(2);
    expect(events.onRebuild).toHaveBeenCalledWith('api', 'error', expect.any(String));
    expect(events.onRebuild).toHaveBeenCalledWith('api', 'complete');
    expect(events.onError).not.toHaveBeenCalled();
  });

  it('gives up after 3 failures and emits error event', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
      onError: vi.fn(),
    };

    buildServiceFn = vi.fn().mockImplementation(() => { throw new Error('persistent failure'); });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    await (watcher as any).rebuild(makeService());

    expect(buildServiceFn).toHaveBeenCalledTimes(3);
    expect(events.onError).toHaveBeenCalledTimes(1);
    const errorCalls = (events.onRebuild as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[1] === 'error'
    );
    expect(errorCalls).toHaveLength(3);
  });

  it('wraps non-GroveError in BuildFailedError', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
      onError: vi.fn(),
    };

    buildServiceFn = vi.fn().mockImplementation(() => { throw new TypeError('unexpected'); });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    await (watcher as any).rebuild(makeService());

    expect(events.onError).toHaveBeenCalledTimes(1);
    const error = (events.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error.code).toBe('BUILD_FAILED');
  });

  it('runs post-rebuild health check on success', async () => {
    mockWaitForHealth.mockResolvedValue(true);

    const events: EnvironmentEvents = {
      onHealthCheck: vi.fn(),
    };

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    await (watcher as any).rebuild(makeService());

    expect(mockWaitForHealth).toHaveBeenCalledWith('http', '127.0.0.1', 10000, '/health', 10, 2000);
    expect(events.onHealthCheck).toHaveBeenCalledWith('api', true);
  });

  it('reports unhealthy after rebuild when health check fails', async () => {
    mockWaitForHealth.mockResolvedValue(false);

    const events: EnvironmentEvents = {
      onHealthCheck: vi.fn(),
    };

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    await (watcher as any).rebuild(makeService());

    expect(events.onHealthCheck).toHaveBeenCalledWith('api', false);
  });

  it('does not crash when events are undefined', async () => {
    const watcher = new FileWatcher(makeConfig(), makeState(), undefined, instantOptions);

    await expect((watcher as any).rebuild(makeService())).resolves.toBeUndefined();
  });

  it('does not run health check for service without health config', async () => {
    const service = makeService();
    delete (service as any).health;

    const watcher = new FileWatcher(makeConfig(), makeState(), undefined, instantOptions);

    await (watcher as any).rebuild(service);

    expect(mockWaitForHealth).not.toHaveBeenCalled();
  });
});
