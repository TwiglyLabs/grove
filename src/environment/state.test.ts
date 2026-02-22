import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroveConfig } from '../config.js';

const { mockExecSync, mockReadFile, mockWriteFile, mockMkdir, mockReaddir, mockUnlink, mockRename, mockAccess, mockStat, mockLock, mockRelease } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockReaddir: vi.fn(),
  mockUnlink: vi.fn(),
  mockRename: vi.fn(),
  mockAccess: vi.fn(),
  mockStat: vi.fn(),
  mockLock: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs/promises', () => ({
  access: mockAccess,
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  readdir: mockReaddir,
  unlink: mockUnlink,
  rename: mockRename,
  stat: mockStat,
}));

vi.mock('proper-lockfile', () => ({
  default: {
    lock: mockLock,
  },
  lock: mockLock,
}));

import { readState, releasePortBlock, loadOrCreateState, writeState, validateState } from './state.js';
import { PortRangeExhaustedError, StateWriteFailedError } from '../shared/errors.js';

function makeConfig(overrides: Partial<GroveConfig> = {}): GroveConfig {
  return {
    project: { name: 'testapp', cluster: 'twiglylabs-local' },
    helm: { chart: 'chart', release: 'testapp', valuesFiles: ['values.yaml'] },
    services: [
      { name: 'api', portForward: { remotePort: 3001 }, health: { path: '/health', protocol: 'http' } },
      { name: 'worker' },
    ],
    frontends: [
      { name: 'webapp', command: 'npm start', cwd: 'webapp' },
    ],
    portBlockSize: 3,
    repoRoot: '/tmp/test-repo',
    ...overrides,
  } as GroveConfig;
}

describe('readState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('feature/test-branch');
  });

  it('returns null when no state file exists', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await readState(makeConfig());

    expect(result).toBeNull();
  });

  it('returns the parsed state when file exists', async () => {
    const state = {
      namespace: 'testapp-feature--test-branch',
      branch: 'feature/test-branch',
      worktreeId: 'feature--test-branch',
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };
    mockReadFile.mockResolvedValue(JSON.stringify(state));

    const result = await readState(makeConfig());

    expect(result).toEqual(state);
  });

  it('returns null when file contains invalid JSON and no .tmp exists', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.endsWith('.tmp')) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve('invalid json{');
    });
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const result = await readState(makeConfig());

    expect(result).toBeNull();
  });

  it('recovers from fresh .tmp when main file is corrupt', async () => {
    const validState = {
      namespace: 'testapp-feature--test-branch',
      branch: 'feature/test-branch',
      worktreeId: 'feature--test-branch',
      ports: { api: 10000 },
      urls: {},
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 5000 }); // 5 seconds old — fresh
    mockReadFile.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.tmp')) {
        return Promise.resolve(JSON.stringify(validState));
      }
      return Promise.resolve('corrupt data{{{');
    });

    const result = await readState(makeConfig());

    expect(result).toEqual(validState);
    expect(mockRename).toHaveBeenCalled();
  });

  it('does not promote stale .tmp file', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 120_000 }); // 2 minutes old — stale
    mockReadFile.mockResolvedValue('corrupt data{{{');

    const result = await readState(makeConfig());

    expect(result).toBeNull();
    expect(mockRename).not.toHaveBeenCalled();
    // Stale .tmp should be deleted
    expect(mockUnlink).toHaveBeenCalled();
  });

  it('returns null when both main and .tmp are corrupt', async () => {
    mockStat.mockResolvedValue({ mtimeMs: Date.now() }); // fresh but corrupt
    mockReadFile.mockResolvedValue('corrupt{{{');

    const result = await readState(makeConfig());

    expect(result).toBeNull();
  });

  it('returns null when main file has invalid state structure', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.endsWith('.tmp')) return Promise.reject(new Error('ENOENT'));
      return Promise.resolve(JSON.stringify({ foo: 'bar' }));
    });
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const result = await readState(makeConfig());

    expect(result).toBeNull();
  });

  it('uses sanitizeBranchName internally', async () => {
    mockExecSync.mockReturnValue('feature/test-branch');
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockStat.mockRejectedValue(new Error('ENOENT'));
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await readState(makeConfig());

    expect(mockExecSync).toHaveBeenCalledWith('git branch --show-current', { encoding: 'utf-8', timeout: 3000 });
  });
});

describe('validateState', () => {
  it('accepts valid state', () => {
    expect(validateState({
      namespace: 'ns',
      worktreeId: 'wt',
      ports: {},
      processes: {},
    })).toBe(true);
  });

  it('rejects null', () => {
    expect(validateState(null)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(validateState('string')).toBe(false);
  });

  it('rejects missing namespace', () => {
    expect(validateState({ worktreeId: 'wt', ports: {}, processes: {} })).toBe(false);
  });

  it('rejects missing worktreeId', () => {
    expect(validateState({ namespace: 'ns', ports: {}, processes: {} })).toBe(false);
  });

  it('rejects missing ports', () => {
    expect(validateState({ namespace: 'ns', worktreeId: 'wt', processes: {} })).toBe(false);
  });

  it('rejects missing processes', () => {
    expect(validateState({ namespace: 'ns', worktreeId: 'wt', ports: {} })).toBe(false);
  });

  it('rejects arrays for ports and processes', () => {
    expect(validateState({ namespace: 'ns', worktreeId: 'wt', ports: [], processes: [] })).toBe(false);
  });

  it('rejects null ports', () => {
    expect(validateState({ namespace: 'ns', worktreeId: 'wt', ports: null, processes: {} })).toBe(false);
  });

  it('rejects null processes', () => {
    expect(validateState({ namespace: 'ns', worktreeId: 'wt', ports: {}, processes: null })).toBe(false);
  });

  it('rejects string ports', () => {
    expect(validateState({ namespace: 'ns', worktreeId: 'wt', ports: 'string', processes: {} })).toBe(false);
  });
});

describe('port allocation (via loadOrCreateState)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('feature/test-branch');
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
    mockReaddir.mockResolvedValue([]);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('allocates ports starting at 10000', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await loadOrCreateState(makeConfig());

    expect(result.ports).toEqual({
      api: 10000,
      webapp: 10001,
    });
  });

  it('skips ports already used by other state files', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue(['other-branch.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({
      ports: { api: 10000, webapp: 10001, other: 10002 },
    }));

    const result = await loadOrCreateState(makeConfig());

    expect(result.ports).toEqual({
      api: 10003,
      webapp: 10004,
    });
  });

  it('returns correct port mapping for services with portForward and frontends', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const config = makeConfig({
      services: [
        { name: 'api', portForward: { remotePort: 3001 } },
        { name: 'auth', portForward: { remotePort: 3002 } },
        { name: 'worker' },
      ],
      frontends: [
        { name: 'webapp', command: 'npm start', cwd: 'webapp' },
        { name: 'admin', command: 'npm start', cwd: 'admin' },
      ],
      portBlockSize: 5,
    });

    const result = await loadOrCreateState(config);

    expect(result.ports).toEqual({
      api: 10000,
      auth: 10001,
      webapp: 10002,
      admin: 10003,
    });
  });

  it('handles config with no frontends', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const config = makeConfig({
      frontends: undefined,
      services: [
        { name: 'api', portForward: { remotePort: 3001 } },
      ],
    });

    const result = await loadOrCreateState(config);

    expect(result.ports).toEqual({
      api: 10000,
    });
  });

  it('handles config with no services with portForward', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const config = makeConfig({
      services: [
        { name: 'worker' },
      ],
      frontends: [
        { name: 'webapp', command: 'npm start', cwd: 'webapp' },
      ],
    });

    const result = await loadOrCreateState(config);

    expect(result.ports).toEqual({
      webapp: 10000,
    });
  });

  it('throws PortRangeExhaustedError when ports exceed 65535', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    // Fill all ports from 10000 to 65535 in blocks of 3
    const usedPorts: Record<string, number> = {};
    for (let p = 10000; p <= 65535; p++) {
      usedPorts[`svc-${p}`] = p;
    }
    mockReaddir.mockResolvedValue(['full.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({ ports: usedPorts }));

    await expect(loadOrCreateState(makeConfig())).rejects.toThrow(PortRangeExhaustedError);
  });

  it('allocates last valid port block at the edge of 65535', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    // Fill all ports from 10000 to 65532, leaving 65533-65535 free.
    // With blockSize=3, block [65533,65534,65535] is the last valid block.
    const usedPorts: Record<string, number> = {};
    for (let p = 10000; p <= 65532; p++) {
      usedPorts[`svc-${p}`] = p;
    }
    mockReaddir.mockResolvedValue(['full.json']);
    mockReadFile.mockResolvedValue(JSON.stringify({ ports: usedPorts }));

    const result = await loadOrCreateState(makeConfig());

    expect(result.ports.api).toBe(65533);
    expect(result.ports.webapp).toBe(65534);
  });
});

describe('releasePortBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
  });

  it('deletes the state file with proper locking', async () => {
    mockAccess.mockResolvedValue(undefined);
    const config = makeConfig();

    await releasePortBlock(config, 'test-branch');

    expect(mockLock).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json', expect.objectContaining({ retries: expect.any(Object) }));
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json');
    expect(mockRelease).toHaveBeenCalled();
  });

  it('handles missing state file gracefully', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const config = makeConfig();

    await expect(releasePortBlock(config, 'test-branch')).resolves.not.toThrow();
    expect(mockLock).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('handles lock errors gracefully', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockLock.mockRejectedValue(new Error('Lock failed'));
    const config = makeConfig();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(releasePortBlock(config, 'test-branch')).resolves.not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to release port block for test-branch'));
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('grove prune'));

    consoleWarnSpy.mockRestore();
  });

  it('succeeds after initial lock contention resolves via lockfile retries', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    // lockfile.lock with retry config handles contention internally;
    // we simulate a single success after the lock resolves
    mockLock.mockResolvedValue(mockRelease);
    const config = makeConfig();

    await releasePortBlock(config, 'test-branch');

    expect(mockLock).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json', expect.objectContaining({ retries: expect.any(Object) }));
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json');
    expect(mockRelease).toHaveBeenCalled();
  });
});

describe('loadOrCreateState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('feature/test-branch');
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('returns existing state when file exists with locking', async () => {
    const state = {
      namespace: 'testapp-feature--test-branch',
      branch: 'feature/test-branch',
      worktreeId: 'feature--test-branch',
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(JSON.stringify(state));

    const result = await loadOrCreateState(makeConfig());

    expect(mockLock).toHaveBeenCalledWith('/tmp/test-repo/.grove/feature--test-branch.json', expect.objectContaining({ retries: expect.any(Object) }));
    expect(result).toEqual(state);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('creates new state with allocated ports when no file exists', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue([]);

    const result = await loadOrCreateState(makeConfig());

    expect(result.ports).toEqual({
      api: 10000,
      webapp: 10001,
    });
    expect(result.urls).toEqual({
      api: 'http://127.0.0.1:10000',
      webapp: 'http://127.0.0.1:10001',
    });
  });

  it('generates correct namespace from project name and worktree ID', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue([]);
    mockExecSync.mockReturnValue('feature/auth-fix');

    const result = await loadOrCreateState(makeConfig());

    expect(result.namespace).toBe('testapp-feature--auth-fix');
    expect(result.worktreeId).toBe('feature--auth-fix');
  });

  it('generates correct URLs for services and frontends', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue([]);
    const config = makeConfig({
      services: [
        { name: 'api', portForward: { remotePort: 3001 }, health: { path: '/health', protocol: 'http' } },
        { name: 'tcp-service', portForward: { remotePort: 5000 }, health: { protocol: 'tcp' } },
      ],
      frontends: [
        { name: 'webapp', command: 'npm start', cwd: 'webapp' },
      ],
    });

    const result = await loadOrCreateState(config);

    expect(result.urls.api).toBe('http://127.0.0.1:10000');
    expect(result.urls['tcp-service']).toBe('tcp://127.0.0.1:10001');
    expect(result.urls.webapp).toBe('http://127.0.0.1:10002');
  });

  it('creates new valid state when file contains empty object', async () => {
    // Simulate: first access (load path) → resolves (file exists), then lock succeeds,
    // readFile returns '{}' (invalid state), so loadOrCreateState falls through.
    // Then sentinel path: access → rejects for sentinel 'wx', lock succeeds,
    // double-check: access for stateFile → resolves, readFile returns '{}' again.
    // Since '{}' fails validateState, it falls through to create new state.
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('{}');
    mockReaddir.mockResolvedValue([]);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadOrCreateState(makeConfig());

    expect(result.ports).toEqual({ api: 10000, webapp: 10001 });
    expect(result.namespace).toBeDefined();
    expect(result.processes).toEqual({});

    consoleWarnSpy.mockRestore();
  });

  it('falls back to creating new state when loading fails', async () => {
    mockAccess.mockResolvedValue(undefined);
    // First lock call (loading existing state) fails; subsequent calls (sentinel + writeState) succeed
    mockLock.mockRejectedValueOnce(new Error('Lock failed'));
    mockReaddir.mockResolvedValue([]);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadOrCreateState(makeConfig());

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load state, creating new'));
    expect(result.ports).toBeDefined();

    consoleWarnSpy.mockRestore();
  });

  it('recovers from fresh .tmp when main file lock fails', async () => {
    const validState = {
      namespace: 'testapp-feature--test-branch',
      branch: 'feature/test-branch',
      worktreeId: 'feature--test-branch',
      ports: { api: 10000, webapp: 10001 },
      urls: {},
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    mockAccess.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() - 5000 }); // 5 seconds old — fresh
    // First lock call (loading existing state) fails
    mockLock.mockRejectedValueOnce(new Error('Lock failed'));
    // .tmp file has valid state; main file read throws (lock failed before read)
    mockReadFile.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.endsWith('.tmp')) {
        return Promise.resolve(JSON.stringify(validState));
      }
      return Promise.reject(new Error('should not read main file after lock failure'));
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadOrCreateState(makeConfig());

    expect(result).toEqual(validState);
    // .tmp should have been promoted to main via rename
    expect(mockRename).toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });
});

describe('writeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('writes to .tmp then renames to main file (atomic write)', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    const state = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    await writeState(state, makeConfig());

    // Should write to .tmp file
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/test-repo/.grove/test-branch.json.tmp',
      expect.stringContaining('"namespace": "testapp-test-branch"'),
      'utf-8'
    );
    // Should rename .tmp to main
    expect(mockRename).toHaveBeenCalledWith(
      '/tmp/test-repo/.grove/test-branch.json.tmp',
      '/tmp/test-repo/.grove/test-branch.json'
    );
  });

  it('creates the .grove directory if needed', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    const state = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: { api: 10000 },
      urls: { api: 'http://127.0.0.1:10000' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    await writeState(state, makeConfig());

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/test-repo/.grove', { recursive: true });
  });

  it('creates the file if it does not exist before locking', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);

    const state = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: { api: 10000 },
      urls: { api: 'http://127.0.0.1:10000' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    await writeState(state, makeConfig());

    const emptyCalls = mockWriteFile.mock.calls.filter(call => call[1] === '{}');
    expect(emptyCalls.length).toBeGreaterThan(0);
  });

  it('updates lastEnsure timestamp', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    const state = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: { api: 10000 },
      urls: { api: 'http://127.0.0.1:10000' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    await writeState(state, makeConfig());

    const writtenContent = mockWriteFile.mock.calls.find(call =>
      typeof call[1] === 'string' && call[1].includes('"namespace"')
    )?.[1];

    expect(writtenContent).toBeDefined();
    const parsed = JSON.parse(writtenContent as string);
    expect(parsed.lastEnsure).not.toBe('2026-02-11T10:00:00Z');
    expect(new Date(parsed.lastEnsure).getTime()).toBeGreaterThan(new Date('2026-02-11T10:00:00Z').getTime());
  });

  it('throws StateWriteFailedError when lock fails', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockLock.mockRejectedValue(new Error('Lock timeout'));
    const state = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: { api: 10000 },
      urls: { api: 'http://127.0.0.1:10000' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    await expect(writeState(state, makeConfig())).rejects.toThrow(StateWriteFailedError);
  });

  it('cleans up .tmp file on failure', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockRename.mockRejectedValue(new Error('rename failed'));
    const state = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: { api: 10000 },
      urls: { api: 'http://127.0.0.1:10000' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    await expect(writeState(state, makeConfig())).rejects.toThrow(StateWriteFailedError);
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json.tmp');
  });
});

describe('getAllUsedPorts (via loadOrCreateState)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('feature/test-branch');
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
    mockRename.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it('logs warning for corrupt JSON state files during port scan', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReaddir.mockResolvedValue(['corrupt.json', 'valid.json']);
    mockReadFile.mockImplementation((path: string) => {
      if (typeof path === 'string' && path.includes('corrupt.json')) {
        return Promise.resolve('not valid json{{{');
      }
      return Promise.resolve(JSON.stringify({ ports: { api: 10000 } }));
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await loadOrCreateState(makeConfig());

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping corrupt state file corrupt.json'));

    consoleWarnSpy.mockRestore();
  });
});
