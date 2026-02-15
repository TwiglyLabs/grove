import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('../watcher.js', () => ({
  FileWatcher: vi.fn(),
}));

vi.mock('../output.js', () => ({
  printInfo: vi.fn(),
  printWarning: vi.fn(),
}));

import { watchCommand } from './watch.js';
import { readState } from '../state.js';
import { FileWatcher } from '../watcher.js';
import { printInfo, printWarning } from '../output.js';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../state.js';

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
  });

  it('returns early with warning when readState returns null', async () => {
    const config = makeConfig();
    vi.mocked(readState).mockReturnValue(null);

    await watchCommand(config);

    expect(printWarning).toHaveBeenCalledWith('No state file found - run "grove up" first');
    expect(FileWatcher).not.toHaveBeenCalled();
  });

  it('creates FileWatcher with config and state', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);

    const mockStart = vi.fn();
    const mockStop = vi.fn();
    vi.mocked(FileWatcher).mockImplementation(function(this: any) {
      this.start = mockStart;
      this.stop = mockStop;
      return this;
    } as any);

    // Don't await - the command sets up a signal handler and doesn't return
    const promise = watchCommand(config);

    // Wait a tick for sync code to execute
    await new Promise(r => setTimeout(r, 10));

    expect(FileWatcher).toHaveBeenCalledWith(config, state);
    expect(FileWatcher).toHaveBeenCalledTimes(1);
  });

  it('calls watcher.start()', async () => {
    const config = makeConfig();
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
    const promise = watchCommand(config);

    // Wait a tick
    await new Promise(r => setTimeout(r, 10));

    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('prints info message about stopping', async () => {
    const config = makeConfig();
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
    const promise = watchCommand(config);

    // Wait a tick
    await new Promise(r => setTimeout(r, 10));

    expect(printInfo).toHaveBeenCalledWith('Press Ctrl+C to stop watching');
  });
});
