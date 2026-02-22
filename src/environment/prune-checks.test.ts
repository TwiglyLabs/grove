import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroveConfig } from '../config.js';

const {
  mockAccess,
  mockReaddir,
  mockReadFile,
  mockWriteFile,
  mockUnlink,
  mockLock,
  mockRelease,
} = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockReaddir: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockUnlink: vi.fn(),
  mockLock: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readdir: mockReaddir,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  unlink: mockUnlink,
}));

vi.mock('proper-lockfile', () => ({
  default: {
    lock: mockLock,
  },
  lock: mockLock,
}));

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import {
  findStoppedProcesses,
  cleanStoppedProcesses,
  findDanglingPorts,
  cleanDanglingPorts,
  findStaleStateFiles,
  cleanStaleStateFiles,
  findOrphanedNamespaces,
  cleanOrphanedNamespaces,
} from './prune-checks.js';

function makeConfig(overrides: Partial<GroveConfig> = {}): GroveConfig {
  return {
    project: { name: 'testapp', cluster: 'twiglylabs-local' },
    helm: { chart: 'chart', release: 'testapp', valuesFiles: ['values.yaml'] },
    services: [
      { name: 'api', portForward: { remotePort: 3001 }, health: { path: '/health', protocol: 'http' } },
    ],
    frontends: [
      { name: 'webapp', command: 'npm start', cwd: 'webapp' },
    ],
    portBlockSize: 3,
    repoRoot: '/tmp/test-repo',
    ...overrides,
  } as GroveConfig;
}

// --- Stopped Processes ---

describe('findStoppedProcesses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
  });

  it('returns empty array when no state files exist', async () => {
    mockReaddir.mockResolvedValue([]);

    const result = await findStoppedProcesses(makeConfig());

    expect(result).toEqual([]);
  });

  it('returns empty array when all processes are running', async () => {
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: { 'port-forward-api': { pid: process.pid, startedAt: '2026-01-01T00:00:00Z' } },
      ports: { api: 10000 },
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));

    const result = await findStoppedProcesses(makeConfig());

    expect(result).toEqual([]);
  });

  it('detects dead processes', async () => {
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: { 'port-forward-api': { pid: 999999, startedAt: '2026-01-01T00:00:00Z' } },
      ports: { api: 10000 },
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));

    const result = await findStoppedProcesses(makeConfig());

    expect(result).toEqual([{
      stateFile: 'main.json',
      processName: 'port-forward-api',
      pid: 999999,
    }]);
  });

  it('detects multiple dead processes across state files', async () => {
    mockReaddir.mockResolvedValue(['branch-a.json', 'branch-b.json']);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({
        worktreeId: 'branch-a',
        processes: {
          'port-forward-api': { pid: 999998, startedAt: '2026-01-01T00:00:00Z' },
        },
        ports: {}, urls: {}, namespace: 'testapp-branch-a', branch: 'branch-a', lastEnsure: '2026-01-01T00:00:00Z',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        worktreeId: 'branch-b',
        processes: {
          'webapp': { pid: 999997, startedAt: '2026-01-01T00:00:00Z' },
        },
        ports: {}, urls: {}, namespace: 'testapp-branch-b', branch: 'branch-b', lastEnsure: '2026-01-01T00:00:00Z',
      }));

    const result = await findStoppedProcesses(makeConfig());

    expect(result).toHaveLength(2);
    expect(result[0].processName).toBe('port-forward-api');
    expect(result[1].processName).toBe('webapp');
  });

  it('skips invalid state files', async () => {
    mockReaddir.mockResolvedValue(['bad.json', 'good.json']);
    mockReadFile
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(JSON.stringify({
        worktreeId: 'good',
        processes: { 'api': { pid: 999999, startedAt: '2026-01-01T00:00:00Z' } },
        ports: {}, urls: {}, namespace: 'testapp-good', branch: 'good', lastEnsure: '2026-01-01T00:00:00Z',
      }));

    const result = await findStoppedProcesses(makeConfig());

    expect(result).toHaveLength(1);
    expect(result[0].stateFile).toBe('good.json');
  });
});

describe('cleanStoppedProcesses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
  });

  it('removes dead processes from state and writes back', async () => {
    const state = {
      worktreeId: 'main',
      processes: {
        'port-forward-api': { pid: 999999, startedAt: '2026-01-01T00:00:00Z' },
        'webapp': { pid: process.pid, startedAt: '2026-01-01T00:00:00Z' },
      },
      ports: { api: 10000, webapp: 10001 },
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    };
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify(state));
    mockWriteFile.mockResolvedValue(undefined);

    const entries = [{ stateFile: 'main.json', processName: 'port-forward-api', pid: 999999 }];

    await cleanStoppedProcesses(makeConfig(), entries);

    // Should have written back the state with the dead process removed
    const writeCall = mockWriteFile.mock.calls.find(
      (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('"namespace"'),
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.processes).not.toHaveProperty('port-forward-api');
    expect(written.processes).toHaveProperty('webapp');
  });

  it('continues when lock acquisition fails', async () => {
    mockLock.mockRejectedValue(new Error('lock failed'));

    const entries = [
      { stateFile: 'a.json', processName: 'api', pid: 999999 },
      { stateFile: 'b.json', processName: 'webapp', pid: 999998 },
    ];

    await expect(cleanStoppedProcesses(makeConfig(), entries)).resolves.toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('handles entries spanning multiple state files', async () => {
    const stateA = {
      worktreeId: 'branch-a',
      processes: {
        'port-forward-api': { pid: 999999, startedAt: '2026-01-01T00:00:00Z' },
        'webapp': { pid: 999998, startedAt: '2026-01-01T00:00:00Z' },
      },
      ports: {}, urls: {}, namespace: 'testapp-branch-a', branch: 'branch-a', lastEnsure: '2026-01-01T00:00:00Z',
    };
    const stateB = {
      worktreeId: 'branch-b',
      processes: {
        'port-forward-api': { pid: 999997, startedAt: '2026-01-01T00:00:00Z' },
      },
      ports: {}, urls: {}, namespace: 'testapp-branch-b', branch: 'branch-b', lastEnsure: '2026-01-01T00:00:00Z',
    };
    mockReadFile
      .mockImplementation(async (path: string) => {
        if ((path as string).includes('branch-a')) return JSON.stringify(stateA);
        if ((path as string).includes('branch-b')) return JSON.stringify(stateB);
        return '{}';
      });
    mockWriteFile.mockResolvedValue(undefined);

    const entries = [
      { stateFile: 'branch-a.json', processName: 'port-forward-api', pid: 999999 },
      { stateFile: 'branch-a.json', processName: 'webapp', pid: 999998 },
      { stateFile: 'branch-b.json', processName: 'port-forward-api', pid: 999997 },
    ];

    await cleanStoppedProcesses(makeConfig(), entries);

    // Should have locked and written both files
    expect(mockLock).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    // Verify file A had both processes removed
    const writeCallA = mockWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('branch-a'),
    );
    expect(writeCallA).toBeDefined();
    const writtenA = JSON.parse(writeCallA![1] as string);
    expect(writtenA.processes).toEqual({});

    // Verify file B had its process removed
    const writeCallB = mockWriteFile.mock.calls.find(
      (call: unknown[]) => (call[0] as string).includes('branch-b'),
    );
    expect(writeCallB).toBeDefined();
    const writtenB = JSON.parse(writeCallB![1] as string);
    expect(writtenB.processes).toEqual({});
  });
});

// --- Dangling Ports ---

describe('findDanglingPorts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
  });

  it('returns empty array when no state files exist', async () => {
    mockReaddir.mockResolvedValue([]);

    const result = await findDanglingPorts(makeConfig());

    expect(result).toEqual([]);
  });

  it('detects ports with no running process', async () => {
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: {},
      ports: { api: 10000, webapp: 10001 },
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));

    const result = await findDanglingPorts(makeConfig());

    expect(result).toHaveLength(2);
    expect(result.map(e => e.portName)).toContain('api');
    expect(result.map(e => e.portName)).toContain('webapp');
  });

  it('does not flag ports that have a running process', async () => {
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: {
        'port-forward-api': { pid: process.pid, startedAt: '2026-01-01T00:00:00Z' },
        'webapp': { pid: process.pid, startedAt: '2026-01-01T00:00:00Z' },
      },
      ports: { api: 10000, webapp: 10001 },
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));

    const result = await findDanglingPorts(makeConfig());

    expect(result).toEqual([]);
  });

  it('only flags ports whose process is dead, keeps ports with running process', async () => {
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: {
        'port-forward-api': { pid: process.pid, startedAt: '2026-01-01T00:00:00Z' },
        'webapp': { pid: 999999, startedAt: '2026-01-01T00:00:00Z' },
      },
      ports: { api: 10000, webapp: 10001, db: 10002 },
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));

    const result = await findDanglingPorts(makeConfig());

    // api has a running process (port-forward-api), so not dangling
    // webapp has a dead process, so its port IS dangling
    // db has no process at all, so dangling
    expect(result).toHaveLength(2);
    const names = result.map(e => e.portName);
    expect(names).toContain('webapp');
    expect(names).toContain('db');
    expect(names).not.toContain('api');
  });
});

describe('cleanDanglingPorts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
  });

  it('removes dangling port entries from state', async () => {
    const state = {
      worktreeId: 'main',
      processes: {},
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    };
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify(state));
    mockWriteFile.mockResolvedValue(undefined);

    const entries = [
      { stateFile: 'main.json', portName: 'api', port: 10000 },
    ];

    await cleanDanglingPorts(makeConfig(), entries);

    const writeCall = mockWriteFile.mock.calls.find(
      (call: unknown[]) => typeof call[1] === 'string' && (call[1] as string).includes('"namespace"'),
    );
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.ports).not.toHaveProperty('api');
    expect(written.urls).not.toHaveProperty('api');
    expect(written.ports).toHaveProperty('webapp');
    expect(written.urls).toHaveProperty('webapp');
  });

  it('continues when lock acquisition fails', async () => {
    mockLock.mockRejectedValue(new Error('lock failed'));

    const entries = [
      { stateFile: 'a.json', portName: 'api', port: 10000 },
      { stateFile: 'b.json', portName: 'webapp', port: 10001 },
    ];

    await expect(cleanDanglingPorts(makeConfig(), entries)).resolves.toBeUndefined();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

// --- Stale State Files ---

describe('findStaleStateFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no state files exist', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue([]);

    const result = await findStaleStateFiles(makeConfig());

    expect(result).toEqual([]);
  });

  it('detects state files whose worktree branch is gone', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(['feature--branch.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'feature--branch',
      processes: {},
      ports: {},
      urls: {},
      namespace: 'testapp-feature--branch',
      branch: 'feature/branch',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));
    // git worktree list returns only main worktree — no feature/branch
    mockExecSync.mockReturnValue('worktree /tmp/test-repo\nbranch refs/heads/main\n\n');

    const result = await findStaleStateFiles(makeConfig());

    expect(result).toEqual([{
      file: 'feature--branch.json',
      worktreeId: 'feature--branch',
    }]);
  });

  it('does not flag state files whose worktree exists', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: {},
      ports: {},
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));
    // git worktree list includes main
    mockExecSync.mockReturnValue('worktree /tmp/test-repo\nbranch refs/heads/main\n\n');

    const result = await findStaleStateFiles(makeConfig());

    expect(result).toEqual([]);
  });

  it('correctly filters mix of stale and valid state files', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(['main.json', 'feature--old.json', 'feature--active.json']);
    mockReadFile
      .mockResolvedValueOnce(JSON.stringify({
        worktreeId: 'main',
        processes: {}, ports: {}, urls: {},
        namespace: 'testapp-main', branch: 'main', lastEnsure: '2026-01-01T00:00:00Z',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        worktreeId: 'feature--old',
        processes: {}, ports: {}, urls: {},
        namespace: 'testapp-feature--old', branch: 'feature/old', lastEnsure: '2026-01-01T00:00:00Z',
      }))
      .mockResolvedValueOnce(JSON.stringify({
        worktreeId: 'feature--active',
        processes: {}, ports: {}, urls: {},
        namespace: 'testapp-feature--active', branch: 'feature/active', lastEnsure: '2026-01-01T00:00:00Z',
      }));
    // git worktree list returns main and feature/active, but NOT feature/old
    mockExecSync.mockReturnValue(
      'worktree /tmp/test-repo\nbranch refs/heads/main\n\n' +
      'worktree /tmp/worktrees/feature-active\nbranch refs/heads/feature/active\n\n',
    );

    const result = await findStaleStateFiles(makeConfig());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ file: 'feature--old.json', worktreeId: 'feature--old' });
  });

  it('does not flag state files when git worktree list fails', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReaddir.mockResolvedValue(['main.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      worktreeId: 'main',
      processes: {},
      ports: {},
      urls: {},
      namespace: 'testapp-main',
      branch: 'main',
      lastEnsure: '2026-01-01T00:00:00Z',
    }));
    // git fails — should be safe and not flag anything
    mockExecSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = await findStaleStateFiles(makeConfig());

    expect(result).toEqual([]);
  });
});

describe('cleanStaleStateFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
    mockUnlink.mockResolvedValue(undefined);
  });

  it('deletes stale state files with locking', async () => {
    const entries = [{ file: 'feature--branch.json', worktreeId: 'feature--branch' }];

    await cleanStaleStateFiles(makeConfig(), entries);

    expect(mockLock).toHaveBeenCalledWith('/tmp/test-repo/.grove/feature--branch.json', expect.any(Object));
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/test-repo/.grove/feature--branch.json');
    expect(mockRelease).toHaveBeenCalled();
  });
});

// --- Orphaned Namespaces ---

describe('findOrphanedNamespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockResolvedValue(undefined);
  });

  it('returns empty array when no namespaces found', async () => {
    mockExecSync.mockReturnValue('');

    const result = await findOrphanedNamespaces(makeConfig());

    expect(result).toEqual([]);
  });

  it('detects namespaces with no state file', async () => {
    mockExecSync.mockReturnValue('testapp-main testapp-old-branch');
    mockAccess.mockImplementation(async (path: string) => {
      if (path.endsWith('.grove')) return undefined; // exists
      if (path.endsWith('main.json')) return undefined; // exists
      throw new Error('ENOENT'); // doesn't exist
    });

    const result = await findOrphanedNamespaces(makeConfig());

    expect(result).toEqual([{ namespace: 'testapp-old-branch' }]);
  });

  it('keeps namespaces that have a state file', async () => {
    mockExecSync.mockReturnValue('testapp-main');
    mockAccess.mockResolvedValue(undefined);

    const result = await findOrphanedNamespaces(makeConfig());

    expect(result).toEqual([]);
  });

  it('ignores namespaces from other projects', async () => {
    mockExecSync.mockReturnValue('testapp-main otherprod-feature kube-system testapp-old-branch');
    mockAccess.mockImplementation(async (path: string) => {
      if (path.endsWith('.grove')) return undefined; // exists
      if (path.endsWith('main.json')) return undefined; // exists
      throw new Error('ENOENT'); // doesn't exist
    });

    const result = await findOrphanedNamespaces(makeConfig());

    // Only testapp-old-branch should be flagged (testapp prefix, no state file)
    // otherprod-feature and kube-system have wrong prefix, testapp-main has a state file
    expect(result).toEqual([{ namespace: 'testapp-old-branch' }]);
  });

  it('handles kubectl failure gracefully', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('kubectl not found');
    });

    const result = await findOrphanedNamespaces(makeConfig());

    expect(result).toEqual([]);
  });
});

describe('cleanOrphanedNamespaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes orphaned namespaces via kubectl', () => {
    const entries = [{ namespace: 'testapp-old-branch' }];

    cleanOrphanedNamespaces(entries);

    expect(mockExecSync).toHaveBeenCalledWith('kubectl delete namespace testapp-old-branch', { stdio: 'pipe' });
  });

  it('continues when namespace deletion fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('Failed to delete');
    });

    const entries = [{ namespace: 'testapp-old-branch' }, { namespace: 'testapp-other' }];

    expect(() => cleanOrphanedNamespaces(entries)).not.toThrow();
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });
});
