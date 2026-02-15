import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('../output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}));

import { downCommand } from './down.js';
import { readState } from '../state.js';
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

function makeState(processes: Record<string, { pid: number; startedAt: string }> = {}): EnvironmentState {
  return {
    namespace: 'test-app-main',
    branch: 'main',
    worktreeId: 'main',
    ports: {},
    urls: {},
    processes,
    lastEnsure: new Date().toISOString(),
  };
}

describe('downCommand', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  it('returns early with warning when readState returns null', async () => {
    const config = makeConfig();
    vi.mocked(readState).mockReturnValue(null);

    await downCommand(config);

    expect(printWarning).toHaveBeenCalledWith('No state file found - environment may not be running');
    expect(printInfo).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('calls process.kill with SIGTERM for each process in state', async () => {
    const config = makeConfig();
    const state = makeState({
      api: { pid: 1234, startedAt: '2026-02-11T10:00:00Z' },
      worker: { pid: 5678, startedAt: '2026-02-11T10:00:00Z' },
    });
    vi.mocked(readState).mockReturnValue(state);

    await downCommand(config);

    expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(5678, 'SIGTERM');
  });

  it('prints success messages for stopped processes', async () => {
    const config = makeConfig();
    const state = makeState({
      api: { pid: 1234, startedAt: '2026-02-11T10:00:00Z' },
      worker: { pid: 5678, startedAt: '2026-02-11T10:00:00Z' },
    });
    vi.mocked(readState).mockReturnValue(state);

    await downCommand(config);

    expect(printSuccess).toHaveBeenCalledWith('Stopped api (PID: 1234)');
    expect(printSuccess).toHaveBeenCalledWith('Stopped worker (PID: 5678)');
    expect(printSuccess).toHaveBeenCalledWith('All processes stopped');
  });

  it('handles process.kill throwing (process already dead)', async () => {
    const config = makeConfig();
    const state = makeState({
      api: { pid: 1234, startedAt: '2026-02-11T10:00:00Z' },
      worker: { pid: 5678, startedAt: '2026-02-11T10:00:00Z' },
    });
    vi.mocked(readState).mockReturnValue(state);

    // First call succeeds, second call throws
    killSpy.mockImplementationOnce(() => true).mockImplementationOnce(() => {
      throw new Error('ESRCH');
    });

    await downCommand(config);

    expect(printSuccess).toHaveBeenCalledWith('Stopped api (PID: 1234)');
    expect(printWarning).toHaveBeenCalledWith('Failed to stop worker (PID: 5678) - may already be stopped');
    expect(printSuccess).toHaveBeenCalledWith('All processes stopped');
  });

  it('prints info message before stopping processes', async () => {
    const config = makeConfig();
    const state = makeState({
      api: { pid: 1234, startedAt: '2026-02-11T10:00:00Z' },
    });
    vi.mocked(readState).mockReturnValue(state);

    await downCommand(config);

    expect(printInfo).toHaveBeenCalledWith('Stopping processes...');
  });

  it('handles empty processes object', async () => {
    const config = makeConfig();
    const state = makeState({});
    vi.mocked(readState).mockReturnValue(state);

    await downCommand(config);

    expect(killSpy).not.toHaveBeenCalled();
    expect(printSuccess).toHaveBeenCalledWith('All processes stopped');
  });
});
