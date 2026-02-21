import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GroveConfig, Service } from '../config.js';
import type { EnvironmentEvents, EnvironmentState } from './types.js';

// Mock chokidar before importing FileWatcher
type ChokidarHandler = (path: string) => void;
const chokidarHandlers: Record<string, ChokidarHandler[]> = {};
const mockChokidarClose = vi.fn();
vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn((event: string, handler: ChokidarHandler) => {
      if (!chokidarHandlers[event]) chokidarHandlers[event] = [];
      chokidarHandlers[event].push(handler);
      return { on: vi.fn().mockReturnThis(), close: mockChokidarClose };
    }),
    close: mockChokidarClose,
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

// Mock fs for handleReloadRequest and watchPaths validation tests
const mockReadFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  };
});

// Mocks for api.ts imports (needed for watch().reload() tests)
const mockLoadConfig = vi.fn();
vi.mock('../shared/config.js', () => ({ load: (...args: unknown[]) => mockLoadConfig(...args) }));
const mockReadState = vi.fn();
vi.mock('./state.js', () => ({
  readState: (...args: unknown[]) => mockReadState(...args),
  releasePortBlock: vi.fn(),
  writeState: vi.fn(),
}));
vi.mock('./controller.js', () => ({ ensureEnvironment: vi.fn() }));
vi.mock('./timing.js', () => ({ Timer: class { elapsed() { return 0; } } }));
vi.mock('./signals.js', () => ({ registerCleanupHandler: vi.fn(), unregisterCleanupHandler: vi.fn() }));
vi.mock('./process-check.js', () => ({ isProcessRunning: vi.fn(), isGroveProcess: vi.fn() }));
vi.mock('./prune-checks.js', () => ({
  findStoppedProcesses: vi.fn(() => []),
  findDanglingPorts: vi.fn(() => []),
  findStaleStateFiles: vi.fn(() => []),
  findOrphanedNamespaces: vi.fn(() => []),
  cleanStoppedProcesses: vi.fn(),
  cleanDanglingPorts: vi.fn(),
  cleanStaleStateFiles: vi.fn(),
  cleanOrphanedNamespaces: vi.fn(),
}));
vi.mock('../workspace/api.js', () => ({
  findOrphanedWorktrees: vi.fn(() => []),
  cleanOrphanedWorktrees: vi.fn(),
}));

import { FileWatcher } from './watcher.js';
import { watch } from './api.js';
import { asRepoId } from '../shared/identity.js';
import { printError as mockPrintError } from '../shared/output.js';

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

describe('FileWatcher scheduleRebuild async error safety', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockWaitForHealth.mockReset();
    mockWaitForHealth.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('catches errors that escape rebuild and routes through onError', async () => {
    // Make onRebuild throw on 'start' — this is outside rebuild's try/catch,
    // so the error escapes and becomes a promise rejection caught by .catch()
    const events: EnvironmentEvents = {
      onRebuild: vi.fn().mockImplementation((_name: string, phase: string) => {
        if (phase === 'start') throw new Error('callback crash');
      }),
      onError: vi.fn(),
    };

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    (watcher as any).scheduleRebuild(makeService());

    await vi.runAllTimersAsync();
    // Flush .catch() microtask
    await Promise.resolve();
    await Promise.resolve();

    expect(events.onError).toHaveBeenCalledTimes(1);
    const error = (events.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error.code).toBe('BUILD_FAILED');
  });

  it('preserves GroveError subclass in scheduleRebuild catch', async () => {
    const { BuildFailedError } = await import('../shared/errors.js');
    const original = new BuildFailedError('api', 'direct throw');

    const events: EnvironmentEvents = {
      onRebuild: vi.fn().mockImplementation((_name: string, phase: string) => {
        if (phase === 'start') throw original;
      }),
      onError: vi.fn(),
    };

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    (watcher as any).scheduleRebuild(makeService());

    await vi.runAllTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(events.onError).toHaveBeenCalledTimes(1);
    const error = (events.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error).toBe(original);
  });
});

describe('watch().reload() error handling', () => {
  const testRepo = asRepoId('repo_test123');

  beforeEach(() => {
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockReadState.mockReturnValue(makeState());
  });

  it('routes build failure through onError event', async () => {
    const events: EnvironmentEvents = {
      onError: vi.fn(),
    };

    buildServiceFn = vi.fn().mockImplementation(() => { throw new Error('docker build failed'); });

    const handle = await watch(testRepo, events);
    handle.reload('api');

    expect(events.onError).toHaveBeenCalledTimes(1);
    const error = (events.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error.code).toBe('BUILD_FAILED');
  });

  it('does not throw when events is undefined', async () => {
    buildServiceFn = vi.fn().mockImplementation(() => { throw new Error('build failed'); });

    const handle = await watch(testRepo);
    expect(() => handle.reload('api')).not.toThrow();
  });

  it('silently returns for unknown service', async () => {
    const handle = await watch(testRepo);
    expect(() => handle.reload('nonexistent')).not.toThrow();
    expect(buildServiceFn).not.toHaveBeenCalled();
  });
});

describe('FileWatcher rebuild loop prevention', () => {
  beforeEach(() => {
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockWaitForHealth.mockReset();
    mockWaitForHealth.mockResolvedValue(true);
  });

  it('coalesces file changes during in-flight rebuild', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
    };

    // Make rebuild take a tick so we can trigger a second scheduleRebuild while in-flight
    let resolveRebuild!: () => void;
    const rebuildGate = new Promise<void>(r => { resolveRebuild = r; });
    buildServiceFn = vi.fn().mockImplementationOnce(async () => {
      await rebuildGate;
    });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    // Start first rebuild
    const rebuildPromise = (watcher as any).rebuild(makeService());

    // While in-flight, schedule another rebuild — should be deferred, not start immediately
    (watcher as any).scheduleRebuild(makeService());

    // The pending set should have it
    expect((watcher as any).pendingRebuild.has('api')).toBe(true);

    // No second rebuild call should have been made yet
    expect(buildServiceFn).toHaveBeenCalledTimes(1);

    // Complete the first rebuild
    resolveRebuild();
    await rebuildPromise;

    // pending should be cleared and a new rebuild scheduled
    expect((watcher as any).pendingRebuild.has('api')).toBe(false);
    // The debounce timer was set for the pending rebuild
    expect((watcher as any).debounceTimers.has('api')).toBe(true);
  });

  it('allows new rebuild after previous completes', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
    };

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);

    // First rebuild completes normally
    await (watcher as any).rebuild(makeService());
    expect(buildServiceFn).toHaveBeenCalledTimes(1);

    // Second rebuild should not be blocked
    expect((watcher as any).rebuilding.has('api')).toBe(false);
    await (watcher as any).rebuild(makeService());
    expect(buildServiceFn).toHaveBeenCalledTimes(2);
  });

  it('clears rebuilding flag even when rebuild fails', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
      onError: vi.fn(),
    };

    buildServiceFn = vi.fn().mockImplementation(() => { throw new Error('build failed'); });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    await (watcher as any).rebuild(makeService());

    // Flag should be cleared despite failure
    expect((watcher as any).rebuilding.has('api')).toBe(false);
  });
});

describe('FileWatcher handleReloadRequest error narrowing', () => {
  beforeEach(() => {
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockReadFileSync.mockReset();
    mockUnlinkSync.mockReset();
  });

  it('silently ignores ENOENT errors', () => {
    const events: EnvironmentEvents = {
      onError: vi.fn(),
    };

    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    (watcher as any).handleReloadRequest('/tmp/test-repo/.reload-request');

    expect(events.onError).not.toHaveBeenCalled();
  });

  it('emits onError for non-ENOENT errors like EACCES', () => {
    const events: EnvironmentEvents = {
      onError: vi.fn(),
    };

    mockReadFileSync.mockImplementation(() => {
      const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    (watcher as any).handleReloadRequest('/tmp/test-repo/.reload-request');

    expect(events.onError).toHaveBeenCalledTimes(1);
    const error = (events.onError as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(error.code).toBe('BUILD_FAILED');
  });
});

describe('FileWatcher stop safety', () => {
  beforeEach(() => {
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockWaitForHealth.mockReset();
    mockWaitForHealth.mockResolvedValue(true);
  });

  it('stop() during in-flight rebuild causes rebuild to return early on next iteration', async () => {
    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
    };

    let resolveFirstAttempt!: () => void;
    const gate = new Promise<void>(r => { resolveFirstAttempt = r; });

    // First attempt fails after a gate, giving us a window to call stop()
    buildServiceFn = vi.fn()
      .mockImplementationOnce(async () => {
        await gate;
        throw new Error('build failed');
      });

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    const rebuildPromise = (watcher as any).rebuild(makeService());

    // Call stop while rebuild is waiting
    watcher.stop();
    expect((watcher as any).stopped).toBe(true);

    // Let the first attempt fail
    resolveFirstAttempt();
    await rebuildPromise;

    // Only 1 attempt should have been made (stopped before attempt 2)
    expect(buildServiceFn).toHaveBeenCalledTimes(1);
  });

  it('stop() prevents verifyServiceHealth from running', async () => {
    const events: EnvironmentEvents = {
      onHealthCheck: vi.fn(),
    };

    const watcher = new FileWatcher(makeConfig(), makeState(), events, instantOptions);
    watcher.stop();

    await (watcher as any).verifyServiceHealth(makeService());

    expect(mockWaitForHealth).not.toHaveBeenCalled();
    expect(events.onHealthCheck).not.toHaveBeenCalled();
  });
});

describe('FileWatcher start() behavior', () => {
  beforeEach(() => {
    buildServiceFn = vi.fn();
    loadImageFn = vi.fn();
    helmUpgradeFn = vi.fn();
    mockWaitForHealth.mockReset();
    mockWaitForHealth.mockResolvedValue(true);
    mockReadFileSync.mockReset();
    mockUnlinkSync.mockReset();
    mockExistsSync.mockReset().mockReturnValue(true);
    // Clear handlers from previous tests
    for (const key of Object.keys(chokidarHandlers)) {
      delete chokidarHandlers[key];
    }
  });

  it('file change in service A path triggers rebuild for A only', () => {
    const config = makeConfig();
    config.services = [
      {
        name: 'api',
        build: { image: 'api:latest', dockerfile: 'Dockerfile', watchPaths: ['src/api/'] },
        portForward: { remotePort: 3000 },
      } as any,
      {
        name: 'web',
        build: { image: 'web:latest', dockerfile: 'Dockerfile', watchPaths: ['src/web/'] },
        portForward: { remotePort: 4000 },
      } as any,
    ];

    const events: EnvironmentEvents = {
      onRebuild: vi.fn(),
    };

    const watcher = new FileWatcher(config, makeState(), events, instantOptions);
    watcher.start();

    // Simulate a file change in the api path
    const changeHandlers = chokidarHandlers['change'] ?? [];
    for (const handler of changeHandlers) {
      handler('/tmp/test-repo/src/api/index.ts');
    }

    // The debounce timer was set for 'api' but not 'web'
    expect((watcher as any).debounceTimers.has('api')).toBe(true);
    expect((watcher as any).debounceTimers.has('web')).toBe(false);

    watcher.stop();
  });

  it('file change matching no service is ignored', () => {
    const watcher = new FileWatcher(makeConfig(), makeState(), undefined, instantOptions);
    watcher.start();

    // Simulate a change to a path that doesn't match any service
    const changeHandlers = chokidarHandlers['change'] ?? [];
    for (const handler of changeHandlers) {
      handler('/tmp/test-repo/unrelated/file.txt');
    }

    expect((watcher as any).debounceTimers.size).toBe(0);

    watcher.stop();
  });

  it('.reload-request creation triggers handleReloadRequest', () => {
    mockReadFileSync.mockReturnValue('api\n');
    mockUnlinkSync.mockImplementation(() => {});

    const watcher = new FileWatcher(makeConfig(), makeState(), undefined, instantOptions);
    watcher.start();

    // Simulate .reload-request file being added
    const addHandlers = chokidarHandlers['add'] ?? [];
    for (const handler of addHandlers) {
      handler('/tmp/test-repo/.reload-request');
    }

    expect(mockReadFileSync).toHaveBeenCalled();
    expect(mockUnlinkSync).toHaveBeenCalled();
    // Should have scheduled a rebuild for 'api'
    expect((watcher as any).debounceTimers.has('api')).toBe(true);

    watcher.stop();
  });

  it('stop() clears pending debounce timers', () => {
    const watcher = new FileWatcher(makeConfig(), makeState(), undefined, instantOptions);
    watcher.start();

    // Simulate a change to trigger a debounce timer
    const changeHandlers = chokidarHandlers['change'] ?? [];
    for (const handler of changeHandlers) {
      handler('/tmp/test-repo/src/index.ts');
    }

    expect((watcher as any).debounceTimers.size).toBe(1);

    watcher.stop();

    expect((watcher as any).debounceTimers.size).toBe(0);
  });

  it('warns about non-existent watchPaths at start', () => {
    mockExistsSync.mockReturnValue(false);

    const watcher = new FileWatcher(makeConfig(), makeState(), undefined, instantOptions);
    watcher.start();

    expect(mockPrintError).toHaveBeenCalledWith(
      expect.stringContaining('Watch path does not exist for api'),
    );

    watcher.stop();
  });
});
