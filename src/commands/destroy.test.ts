import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../api/environment.js', () => ({
  destroy: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}));

import { destroyCommand } from './destroy.js';
import { destroy } from '../api/environment.js';
import { printSuccess, printWarning } from '../shared/output.js';
import { asRepoId } from '../shared/identity.js';

const testRepoId = asRepoId('repo_test123');

describe('destroyCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports when namespace deleted successfully', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [],
        notRunning: [],
      },
      namespaceDeleted: true,
      stateRemoved: true,
    });

    await destroyCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Namespace deleted');
    expect(printSuccess).toHaveBeenCalledWith('State file removed');
    expect(printSuccess).toHaveBeenCalledWith('Environment destroyed');
  });

  it('handles kubectl failure gracefully', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [],
        notRunning: [],
      },
      namespaceDeleted: false,
      stateRemoved: true,
    });

    await destroyCommand(testRepoId);

    expect(printWarning).toHaveBeenCalledWith('Failed to delete namespace - it may not exist');
    expect(printSuccess).toHaveBeenCalledWith('State file removed');
    expect(printSuccess).toHaveBeenCalledWith('Environment destroyed');
  });

  it('handles releasePortBlock failure gracefully', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [],
        notRunning: [],
      },
      namespaceDeleted: true,
      stateRemoved: false,
    });

    await destroyCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Namespace deleted');
    expect(printWarning).toHaveBeenCalledWith('Failed to remove state file');
    expect(printSuccess).toHaveBeenCalledWith('Environment destroyed');
  });

  it('prints stopped processes', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [
          { name: 'api', pid: 1234, success: true },
          { name: 'worker', pid: 5678, success: true },
        ],
        notRunning: [],
      },
      namespaceDeleted: true,
      stateRemoved: true,
    });

    await destroyCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Stopped api (PID: 1234)');
    expect(printSuccess).toHaveBeenCalledWith('Stopped worker (PID: 5678)');
  });

  it('prints failed process stops', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [
          { name: 'api', pid: 1234, success: false },
        ],
        notRunning: [],
      },
      namespaceDeleted: true,
      stateRemoved: true,
    });

    await destroyCommand(testRepoId);

    expect(printWarning).toHaveBeenCalledWith('Failed to stop api (PID: 1234)');
  });

  it('prints final success message after cleanup', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [],
        notRunning: [],
      },
      namespaceDeleted: true,
      stateRemoved: true,
    });

    await destroyCommand(testRepoId);

    expect(printSuccess).toHaveBeenCalledWith('Environment destroyed');
  });

  it('calls destroy API with correct repoId', async () => {
    vi.mocked(destroy).mockResolvedValue({
      stopped: {
        stopped: [],
        notRunning: [],
      },
      namespaceDeleted: false,
      stateRemoved: false,
    });

    await destroyCommand(testRepoId);

    expect(destroy).toHaveBeenCalledWith(testRepoId);
  });
});
