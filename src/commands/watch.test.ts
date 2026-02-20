import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('../environment/state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('../environment/watcher.js', () => ({
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
vi.mock('../environment/api.js', async () => {
  const { EnvironmentNotRunningError } = await import('../shared/errors.js');
  const { readState } = await import('../environment/state.js');
  const { FileWatcher } = await import('../environment/watcher.js');
  const loadConfig = (await import('../shared/config.js')).load;
  return {
    up: vi.fn(),
    down: vi.fn(),
    destroy: vi.fn(),
    status: vi.fn(),
    watch: vi.fn(async (repo: any) => {
      const config = await loadConfig(repo);
      const state = readState(config);
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

import { watchCommand } from '../environment/cli.js';
import { load as loadConfig } from '../shared/config.js';
import { readState } from '../environment/state.js';
import { FileWatcher } from '../environment/watcher.js';
import { printInfo, printWarning } from '../shared/output.js';
import { asRepoId } from '../shared/identity.js';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../environment/types.js';

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
    vi.mocked(readState).mockReturnValue(null);

    await watchCommand(testRepoId);

    expect(printWarning).toHaveBeenCalledWith('No state file found - run "grove up" first');
    expect(FileWatcher).not.toHaveBeenCalled();
  });

  it('creates FileWatcher with config and state', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(loadConfig).mockResolvedValue(config);
    vi.mocked(readState).mockReturnValue(state);

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
    vi.mocked(readState).mockReturnValue(state);

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
    vi.mocked(readState).mockReturnValue(state);

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
