import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  execSync: mockExecSync,
  spawn: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printError: vi.fn(),
  printWarning: vi.fn(),
  printSection: vi.fn(),
}));

vi.mock('./signals.js', () => ({
  registerCleanupHandler: vi.fn(),
  unregisterCleanupHandler: vi.fn(),
}));

vi.mock('./process-check.js', () => ({
  isProcessRunning: vi.fn(() => false),
  isGroveProcess: vi.fn(() => false),
}));

const mockReadState = vi.fn();
const mockWriteState = vi.fn();
const mockReleasePortBlock = vi.fn();
vi.mock('./state.js', () => ({
  readState: mockReadState,
  writeState: mockWriteState,
  releasePortBlock: mockReleasePortBlock,
}));

vi.mock('./controller.js', () => ({
  ensureEnvironment: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  load: vi.fn(() => ({
    repoRoot: '/tmp/test-repo',
    portBlockSize: 10,
    project: { name: 'test', cluster: 'test-cluster', clusterType: 'kind' },
    helm: { chart: './chart', release: 'test', valuesFiles: ['values.yaml'] },
    services: [],
    frontends: [],
  })),
}));

import { printError } from '../shared/output.js';
import type { RepoId } from '../shared/identity.js';

const { destroy } = await import('./api.js');

const testRepoId = 'repo_test123' as RepoId;

describe('destroy — namespace error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds silently when namespace does not exist (not found)', async () => {
    mockReadState.mockResolvedValue({
      namespace: 'test-ns',
      worktreeId: 'main',
      processes: {},
      ports: {},
      urls: {},
    });

    const notFoundError = new Error('Command failed');
    (notFoundError as unknown as { stderr: string }).stderr = 'Error from server (NotFound): namespaces "test-ns" not found';
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('kubectl delete namespace')) {
        throw notFoundError;
      }
    });

    const result = await destroy(testRepoId);

    expect(result.namespaceDeleted).toBe(false);
    expect(printError).not.toHaveBeenCalled();
  });

  it('succeeds silently when error message contains "not found"', async () => {
    mockReadState.mockResolvedValue({
      namespace: 'test-ns',
      worktreeId: 'main',
      processes: {},
      ports: {},
      urls: {},
    });

    const notFoundError = new Error('namespaces "test-ns" not found');
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('kubectl delete namespace')) {
        throw notFoundError;
      }
    });

    const result = await destroy(testRepoId);

    expect(result.namespaceDeleted).toBe(false);
    expect(printError).not.toHaveBeenCalled();
  });

  it('prints error when namespace deletion fails for non-NotFound reason', async () => {
    mockReadState.mockResolvedValue({
      namespace: 'test-ns',
      worktreeId: 'main',
      processes: {},
      ports: {},
      urls: {},
    });

    const timeoutError = new Error('Command timed out');
    (timeoutError as unknown as { stderr: string }).stderr = 'namespace stuck in Terminating state';
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('kubectl delete namespace')) {
        throw timeoutError;
      }
    });

    const result = await destroy(testRepoId);

    expect(result.namespaceDeleted).toBe(false);
    expect(printError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to delete namespace'),
    );
  });

  it('includes error details in the printed message', async () => {
    mockReadState.mockResolvedValue({
      namespace: 'test-ns',
      worktreeId: 'main',
      processes: {},
      ports: {},
      urls: {},
    });

    const error = new Error('Connection refused');
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('kubectl delete namespace')) {
        throw error;
      }
    });

    await destroy(testRepoId);

    expect(printError).toHaveBeenCalledWith(
      expect.stringContaining('Connection refused'),
    );
  });
});
