import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('./state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('./watcher.js', () => ({
  FileWatcher: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printWarning: vi.fn(),
  printBanner: vi.fn(),
  printUrlTable: vi.fn(),
  printSuccess: vi.fn(),
  printError: vi.fn(),
  printDashboard: vi.fn(),
}));

// Mock the environment API to prevent real calls
vi.mock('./api.js', async () => {
  const { EnvironmentNotRunningError } = await import('../shared/errors.js');
  const { readState } = await import('./state.js');
  const { FileWatcher } = await import('./watcher.js');
  const loadConfig = (await import('../shared/config.js')).load;
  return {
    up: vi.fn(),
    down: vi.fn(),
    destroy: vi.fn(),
    status: vi.fn(),
    watch: vi.fn(async (repo: any) => {
      const config = await loadConfig(repo);
      const state = await readState(config);
      if (!state) {
        throw new EnvironmentNotRunningError();
      }
      const watcher = new (FileWatcher as any)(config, state);
      watcher.start();
      return {
        stop() { watcher.stop(); },
        reload() {},
      };
    }),
    reload: vi.fn(),
    prune: vi.fn(),
  };
});

import { watchCommand } from './cli.js';
import { load as loadConfig } from '../shared/config.js';
import { readState } from './state.js';
import { FileWatcher } from './watcher.js';
import { printInfo, printWarning } from '../shared/output.js';
import { asRepoId } from '../shared/identity.js';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from './types.js';

const testRepoId = asRepoId('repo_test123');

function makeConfig(): GroveConfig {
  return {
    project: { name: 'test-app', cluster: 'test-cluster' },
    repoRoot: '/tmp/test-repo',
    services: [],
    helm: { chart: 'test', release: 'test', valuesFiles: [] },
    portBlockSize: 5,
  } as unknown as GroveConfig;
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

describe('watchCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(makeConfig());
  });

  it('returns early with warning when readState returns null', async () => {
    vi.mocked(readState).mockResolvedValue(null);

    await watchCommand(testRepoId);

    expect(printWarning).toHaveBeenCalledWith('No state file found - run "grove up" first');
    expect(FileWatcher).not.toHaveBeenCalled();
  });

  it('creates FileWatcher with config and state', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(readState).mockResolvedValue(state);

    const mockStart = vi.fn();
    const mockStop = vi.fn();
    vi.mocked(FileWatcher).mockImplementation(function(this: any) {
      this.start = mockStart;
      this.stop = mockStop;
      return this;
    } as any);

    // Don't await - the command sets up a signal handler and doesn't return
    const promise = watchCommand(testRepoId);

    // Wait a tick for sync code to execute
    await new Promise(r => setTimeout(r, 10));

    expect(FileWatcher).toHaveBeenCalledWith(config, state);
    expect(FileWatcher).toHaveBeenCalledTimes(1);
  });

  it('calls watcher.start()', async () => {
    const state = makeState();
    vi.mocked(readState).mockResolvedValue(state);

    const mockStart = vi.fn();
    const mockStop = vi.fn();
    vi.mocked(FileWatcher).mockImplementation(function(this: any) {
      this.start = mockStart;
      this.stop = mockStop;
      return this;
    } as any);

    // Don't await
    const promise = watchCommand(testRepoId);

    // Wait a tick
    await new Promise(r => setTimeout(r, 10));

    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('prints info message about stopping', async () => {
    const state = makeState();
    vi.mocked(readState).mockResolvedValue(state);

    const mockStart = vi.fn();
    const mockStop = vi.fn();
    vi.mocked(FileWatcher).mockImplementation(function(this: any) {
      this.start = mockStart;
      this.stop = mockStop;
      return this;
    } as any);

    // Don't await
    const promise = watchCommand(testRepoId);

    // Wait a tick
    await new Promise(r => setTimeout(r, 10));

    expect(printInfo).toHaveBeenCalledWith('Press Ctrl+C to stop watching');
  });
});
