import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../state.js', () => ({
  readState: vi.fn(),
  releasePortBlock: vi.fn(),
}));

vi.mock('./down.js', () => ({
  downCommand: vi.fn(),
}));

vi.mock('../output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}));

import { execSync } from 'child_process';
import { destroyCommand } from './destroy.js';
import { readState, releasePortBlock } from '../state.js';
import { downCommand } from './down.js';
import { printInfo, printSuccess, printWarning } from '../output.js';
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

describe('destroyCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls downCommand before doing anything else', async () => {
    const config = makeConfig();
    vi.mocked(readState).mockReturnValue(null);

    await destroyCommand(config);

    expect(downCommand).toHaveBeenCalledWith(config);
    expect(downCommand).toHaveBeenCalledTimes(1);
  });

  it('returns early if readState returns null after calling downCommand', async () => {
    const config = makeConfig();
    vi.mocked(readState).mockReturnValue(null);

    await destroyCommand(config);

    expect(downCommand).toHaveBeenCalledWith(config);
    expect(printWarning).toHaveBeenCalledWith('No state file found');
    expect(execSync).not.toHaveBeenCalled();
    expect(releasePortBlock).not.toHaveBeenCalled();
  });

  it('deletes namespace via kubectl', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);

    await destroyCommand(config);

    expect(execSync).toHaveBeenCalledWith(
      'kubectl delete namespace test-app-main',
      { stdio: 'inherit' }
    );
    expect(printInfo).toHaveBeenCalledWith('Deleting namespace test-app-main...');
    expect(printSuccess).toHaveBeenCalledWith('Namespace deleted');
  });

  it('calls releasePortBlock with correct worktreeId', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);

    await destroyCommand(config);

    expect(releasePortBlock).toHaveBeenCalledWith(config, 'main');
    expect(printSuccess).toHaveBeenCalledWith('State file removed');
  });

  it('handles kubectl failure gracefully', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('kubectl error');
    });

    await destroyCommand(config);

    expect(printWarning).toHaveBeenCalledWith('Failed to delete namespace - it may not exist');
    // Should still try to release port block
    expect(releasePortBlock).toHaveBeenCalledWith(config, 'main');
  });

  it('handles releasePortBlock failure gracefully', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);
    vi.mocked(releasePortBlock).mockImplementation(() => {
      throw new Error('release error');
    });

    await destroyCommand(config);

    expect(printWarning).toHaveBeenCalledWith('Failed to remove state file');
    expect(printSuccess).toHaveBeenCalledWith('Environment destroyed');
  });

  it('prints final success message after cleanup', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);

    await destroyCommand(config);

    expect(printSuccess).toHaveBeenCalledWith('Environment destroyed');
  });

  it('prints all expected info messages', async () => {
    const config = makeConfig();
    const state = makeState();
    vi.mocked(readState).mockReturnValue(state);

    await destroyCommand(config);

    expect(printInfo).toHaveBeenCalledWith('Deleting namespace test-app-main...');
    expect(printInfo).toHaveBeenCalledWith('Removing state file...');
  });
});
