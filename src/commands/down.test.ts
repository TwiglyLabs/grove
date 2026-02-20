import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../environment/api.js', () => ({
  down: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}));

import { downCommand } from '../environment/cli.js';
import { down } from '../environment/api.js';
import { printInfo, printSuccess, printWarning } from '../shared/output.js';
import { asRepoId } from '../shared/identity.js';

const testRepoId = asRepoId('repo_test123');

describe('downCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early with warning when no state found', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [],
      notRunning: [],
    });

    await downCommand(testRepoId);

    expect(printWarning).toHaveBeenCalledWith('No state file found - environment may not be running');
    expect(printSuccess).not.toHaveBeenCalled();
  });

  it('prints success messages for stopped processes', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [
        { name: 'api', pid: 1234, success: true },
        { name: 'worker', pid: 5678, success: true },
      ],
      notRunning: [],
    });

    await downCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Stopped api (PID: 1234)');
    expect(printSuccess).toHaveBeenCalledWith('Stopped worker (PID: 5678)');
    expect(printSuccess).toHaveBeenCalledWith('All processes stopped');
  });

  it('handles failed stop attempts', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [
        { name: 'api', pid: 1234, success: true },
        { name: 'worker', pid: 5678, success: false },
      ],
      notRunning: [],
    });

    await downCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Stopped api (PID: 1234)');
    expect(printWarning).toHaveBeenCalledWith('Failed to stop worker (PID: 5678)');
    expect(printSuccess).toHaveBeenCalledWith('All processes stopped');
  });

  it('handles processes that were not running', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [
        { name: 'api', pid: 1234, success: true },
      ],
      notRunning: ['worker'],
    });

    await downCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Stopped api (PID: 1234)');
    expect(printWarning).toHaveBeenCalledWith('worker - already stopped');
    expect(printSuccess).toHaveBeenCalledWith('All processes stopped');
  });

  it('prints info message before stopping processes', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [
        { name: 'api', pid: 1234, success: true },
      ],
      notRunning: [],
    });

    await downCommand(testRepoId);

    expect(printInfo).toHaveBeenCalledWith('Stopping processes...');
  });

  it('handles empty result', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [],
      notRunning: [],
    });

    await downCommand(testRepoId);

    expect(printWarning).toHaveBeenCalledWith('No state file found - environment may not be running');
  });

  it('calls down API with correct repoId', async () => {
    vi.mocked(down).mockResolvedValue({
      stopped: [],
      notRunning: [],
    });

    await downCommand(testRepoId);

    expect(down).toHaveBeenCalledWith(testRepoId);
  });
});
