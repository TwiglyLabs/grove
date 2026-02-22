import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroveConfig } from '../config.js';

// --- Hoisted mocks ---

const {
  mockLoadConfig,
  mockFindStoppedProcesses,
  mockCleanStoppedProcesses,
  mockFindDanglingPorts,
  mockCleanDanglingPorts,
  mockFindStaleStateFiles,
  mockCleanStaleStateFiles,
  mockFindOrphanedNamespaces,
  mockCleanOrphanedNamespaces,
  mockFindOrphanedWs,
  mockCleanOrphanedWs,
} = vi.hoisted(() => ({
  mockLoadConfig: vi.fn(),
  mockFindStoppedProcesses: vi.fn(),
  mockCleanStoppedProcesses: vi.fn(),
  mockFindDanglingPorts: vi.fn(),
  mockCleanDanglingPorts: vi.fn(),
  mockFindStaleStateFiles: vi.fn(),
  mockCleanStaleStateFiles: vi.fn(),
  mockFindOrphanedNamespaces: vi.fn(),
  mockCleanOrphanedNamespaces: vi.fn(),
  mockFindOrphanedWs: vi.fn(),
  mockCleanOrphanedWs: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  load: mockLoadConfig,
}));

vi.mock('./prune-checks.js', () => ({
  findStoppedProcesses: mockFindStoppedProcesses,
  cleanStoppedProcesses: mockCleanStoppedProcesses,
  findDanglingPorts: mockFindDanglingPorts,
  cleanDanglingPorts: mockCleanDanglingPorts,
  findStaleStateFiles: mockFindStaleStateFiles,
  cleanStaleStateFiles: mockCleanStaleStateFiles,
  findOrphanedNamespaces: mockFindOrphanedNamespaces,
  cleanOrphanedNamespaces: mockCleanOrphanedNamespaces,
}));

vi.mock('../workspace/api.js', () => ({
  findOrphanedWorktrees: mockFindOrphanedWs,
  cleanOrphanedWorktrees: mockCleanOrphanedWs,
}));

// Mock other imports that api.ts uses
vi.mock('./controller.js', () => ({
  ensureEnvironment: vi.fn(),
}));

vi.mock('./state.js', () => ({
  readState: vi.fn(),
  releasePortBlock: vi.fn(),
}));

vi.mock('./watcher.js', () => ({
  FileWatcher: vi.fn(),
}));

vi.mock('./processes/BuildOrchestrator.js', () => ({
  BuildOrchestrator: vi.fn(),
}));

vi.mock('./providers/index.js', () => ({
  createClusterProvider: vi.fn(),
}));

import { prune } from './api.js';
import type { RepoId } from '../shared/identity.js';

const testRepoId = 'repo_abc123xyz' as RepoId;

function makeConfig(): GroveConfig {
  return {
    project: { name: 'testapp', cluster: 'twiglylabs-local' },
    helm: { chart: 'chart', release: 'testapp', valuesFiles: ['values.yaml'] },
    services: [{ name: 'api' }],
    portBlockSize: 2,
    repoRoot: '/tmp/test-repo',
  } as GroveConfig;
}

describe('prune (unified)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockResolvedValue(makeConfig());
    mockFindStoppedProcesses.mockResolvedValue([]);
    mockCleanStoppedProcesses.mockResolvedValue(undefined);
    mockFindDanglingPorts.mockResolvedValue([]);
    mockCleanDanglingPorts.mockResolvedValue(undefined);
    mockFindStaleStateFiles.mockResolvedValue([]);
    mockFindOrphanedNamespaces.mockResolvedValue([]);
    mockFindOrphanedWs.mockResolvedValue([]);
  });

  it('returns empty results when nothing is orphaned', async () => {
    const result = await prune(testRepoId);

    expect(result).toEqual({
      stoppedProcesses: [],
      danglingPorts: [],
      staleStateFiles: [],
      orphanedWorktrees: [],
      orphanedNamespaces: [],
      dryRun: false,
    });
  });

  it('returns all categories of detected issues', async () => {
    mockFindStoppedProcesses.mockResolvedValue([
      { stateFile: 'main.json', processName: 'api', pid: 1234 },
    ]);
    mockFindDanglingPorts.mockResolvedValue([
      { stateFile: 'main.json', portName: 'api', port: 10000 },
    ]);
    mockFindStaleStateFiles.mockResolvedValue([
      { file: 'old.json', worktreeId: 'old' },
    ]);
    mockFindOrphanedWs.mockResolvedValue([
      { path: '/gone', workspaceId: 'ws-1' },
    ]);
    mockFindOrphanedNamespaces.mockResolvedValue([
      { namespace: 'testapp-old' },
    ]);

    const result = await prune(testRepoId);

    expect(result.stoppedProcesses).toHaveLength(1);
    expect(result.danglingPorts).toHaveLength(1);
    expect(result.staleStateFiles).toHaveLength(1);
    expect(result.orphanedWorktrees).toHaveLength(1);
    expect(result.orphanedNamespaces).toHaveLength(1);
  });

  it('executes cleanup when dryRun is false', async () => {
    mockFindStoppedProcesses.mockResolvedValue([
      { stateFile: 'main.json', processName: 'api', pid: 1234 },
    ]);
    mockFindDanglingPorts.mockResolvedValue([
      { stateFile: 'main.json', portName: 'api', port: 10000 },
    ]);
    mockFindStaleStateFiles.mockResolvedValue([
      { file: 'old.json', worktreeId: 'old' },
    ]);
    mockFindOrphanedWs.mockResolvedValue([
      { path: '/gone', workspaceId: 'ws-1' },
    ]);
    mockFindOrphanedNamespaces.mockResolvedValue([
      { namespace: 'testapp-old' },
    ]);

    await prune(testRepoId);

    expect(mockCleanStoppedProcesses).toHaveBeenCalled();
    expect(mockCleanDanglingPorts).toHaveBeenCalled();
    expect(mockCleanStaleStateFiles).toHaveBeenCalled();
    expect(mockCleanOrphanedWs).toHaveBeenCalled();
    expect(mockCleanOrphanedNamespaces).toHaveBeenCalled();
  });

  it('skips cleanup when dryRun is true', async () => {
    mockFindStoppedProcesses.mockResolvedValue([
      { stateFile: 'main.json', processName: 'api', pid: 1234 },
    ]);
    mockFindDanglingPorts.mockResolvedValue([
      { stateFile: 'main.json', portName: 'api', port: 10000 },
    ]);
    mockFindStaleStateFiles.mockResolvedValue([
      { file: 'old.json', worktreeId: 'old' },
    ]);
    mockFindOrphanedWs.mockResolvedValue([
      { path: '/gone', workspaceId: 'ws-1' },
    ]);
    mockFindOrphanedNamespaces.mockResolvedValue([
      { namespace: 'testapp-old' },
    ]);

    const result = await prune(testRepoId, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.stoppedProcesses).toHaveLength(1);
    expect(result.danglingPorts).toHaveLength(1);
    expect(result.staleStateFiles).toHaveLength(1);
    expect(result.orphanedWorktrees).toHaveLength(1);
    expect(result.orphanedNamespaces).toHaveLength(1);

    // No cleanup should have been called
    expect(mockCleanStoppedProcesses).not.toHaveBeenCalled();
    expect(mockCleanDanglingPorts).not.toHaveBeenCalled();
    expect(mockCleanStaleStateFiles).not.toHaveBeenCalled();
    expect(mockCleanOrphanedWs).not.toHaveBeenCalled();
    expect(mockCleanOrphanedNamespaces).not.toHaveBeenCalled();
  });

  it('skips cleanup when no issues found (even with dryRun false)', async () => {
    await prune(testRepoId);

    expect(mockCleanStoppedProcesses).not.toHaveBeenCalled();
    expect(mockCleanDanglingPorts).not.toHaveBeenCalled();
    expect(mockCleanStaleStateFiles).not.toHaveBeenCalled();
    expect(mockCleanOrphanedWs).not.toHaveBeenCalled();
    expect(mockCleanOrphanedNamespaces).not.toHaveBeenCalled();
  });

  it('sets dryRun flag in result', async () => {
    const dryResult = await prune(testRepoId, { dryRun: true });
    expect(dryResult.dryRun).toBe(true);

    const normalResult = await prune(testRepoId);
    expect(normalResult.dryRun).toBe(false);
  });

  it('executes cleanup in correct order: processes → ports → state files → worktrees → namespaces', async () => {
    const callOrder: string[] = [];

    mockFindStoppedProcesses.mockResolvedValue([
      { stateFile: 'main.json', processName: 'api', pid: 1234 },
    ]);
    mockFindDanglingPorts.mockResolvedValue([
      { stateFile: 'main.json', portName: 'api', port: 10000 },
    ]);
    mockFindStaleStateFiles.mockResolvedValue([
      { file: 'old.json', worktreeId: 'old' },
    ]);
    mockFindOrphanedWs.mockResolvedValue([
      { path: '/gone', workspaceId: 'ws-1' },
    ]);
    mockFindOrphanedNamespaces.mockResolvedValue([
      { namespace: 'testapp-old' },
    ]);

    mockCleanStoppedProcesses.mockImplementation(async () => { callOrder.push('processes'); });
    mockCleanDanglingPorts.mockImplementation(async () => { callOrder.push('ports'); });
    mockCleanStaleStateFiles.mockImplementation(() => { callOrder.push('stateFiles'); });
    mockCleanOrphanedWs.mockImplementation(() => { callOrder.push('worktrees'); });
    mockCleanOrphanedNamespaces.mockImplementation(() => { callOrder.push('namespaces'); });

    await prune(testRepoId);

    expect(callOrder).toEqual(['processes', 'ports', 'stateFiles', 'worktrees', 'namespaces']);
  });
});
