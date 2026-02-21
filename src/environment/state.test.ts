import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GroveConfig } from '../config.js';

const { mockExecSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockReaddirSync, mockUnlinkSync, mockExistsSync, mockLockSync, mockLock, mockRelease } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockLockSync: vi.fn(),
  mockLock: vi.fn(),
  mockRelease: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock('proper-lockfile', () => ({
  default: {
    lockSync: mockLockSync,
    lock: mockLock,
  },
  lockSync: mockLockSync,
  lock: mockLock,
}));

import { readState, allocatePortBlock, releasePortBlock, loadOrCreateState, writeState } from './state.js';

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

  it('returns null when no state file exists', () => {
    mockExistsSync.mockReturnValue(false);

    const result = readState(makeConfig());

    expect(result).toBeNull();
  });

  it('returns the parsed state when file exists', () => {
    mockExistsSync.mockReturnValue(true);
    const state = {
      namespace: 'testapp-feature--test-branch',
      branch: 'feature/test-branch',
      worktreeId: 'feature--test-branch',
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    const result = readState(makeConfig());

    expect(result).toEqual(state);
  });

  it('returns null when file contains invalid JSON', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('invalid json{');

    const result = readState(makeConfig());

    expect(result).toBeNull();
  });

  it('uses sanitizeBranchName internally', () => {
    mockExecSync.mockReturnValue('feature/test-branch');
    mockExistsSync.mockReturnValue(false);

    readState(makeConfig());

    expect(mockExecSync).toHaveBeenCalledWith('git branch --show-current', { encoding: 'utf-8' });
  });
});

describe('allocatePortBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
  });

  it('allocates ports starting at 10000', () => {
    const config = makeConfig();
    const ports = allocatePortBlock(config);

    expect(ports).toEqual({
      api: 10000,
      webapp: 10001,
    });
  });

  it('skips ports already used by other state files', () => {
    const config = makeConfig();
    mockReaddirSync.mockReturnValue(['other-branch.json']);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      ports: { api: 10000, webapp: 10001, other: 10002 },
    }));

    const ports = allocatePortBlock(config);

    expect(ports).toEqual({
      api: 10003,
      webapp: 10004,
    });
  });

  it('returns correct port mapping for services with portForward and frontends', () => {
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
    });

    const ports = allocatePortBlock(config);

    expect(ports).toEqual({
      api: 10000,
      auth: 10001,
      webapp: 10002,
      admin: 10003,
    });
  });

  it('handles config with no frontends', () => {
    const config = makeConfig({
      frontends: undefined,
      services: [
        { name: 'api', portForward: { remotePort: 3001 } },
      ],
    });

    const ports = allocatePortBlock(config);

    expect(ports).toEqual({
      api: 10000,
    });
  });

  it('handles config with no services with portForward', () => {
    const config = makeConfig({
      services: [
        { name: 'worker' },
      ],
      frontends: [
        { name: 'webapp', command: 'npm start', cwd: 'webapp' },
      ],
    });

    const ports = allocatePortBlock(config);

    expect(ports).toEqual({
      webapp: 10000,
    });
  });
});

describe('releasePortBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelease.mockReturnValue(undefined);
    mockLockSync.mockReturnValue(mockRelease);
  });

  it('deletes the state file with proper locking', () => {
    mockExistsSync.mockReturnValue(true);
    const config = makeConfig();

    releasePortBlock(config, 'test-branch');

    expect(mockLockSync).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json', expect.objectContaining({ stale: 10000 }));
    expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/test-repo/.grove/test-branch.json');
    expect(mockRelease).toHaveBeenCalled();
  });

  it('handles missing state file gracefully', () => {
    mockExistsSync.mockReturnValue(false);
    const config = makeConfig();

    expect(() => releasePortBlock(config, 'test-branch')).not.toThrow();
    expect(mockLockSync).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('handles lock errors gracefully', () => {
    mockExistsSync.mockReturnValue(true);
    mockLockSync.mockImplementation(() => {
      throw new Error('Lock failed');
    });
    const config = makeConfig();
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => releasePortBlock(config, 'test-branch')).not.toThrow();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to release port block'));

    consoleWarnSpy.mockRestore();
  });
});

describe('loadOrCreateState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue('feature/test-branch');
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
  });

  it('returns existing state when file exists with locking', async () => {
    mockExistsSync.mockReturnValue(true);
    const state = {
      namespace: 'testapp-feature--test-branch',
      branch: 'feature/test-branch',
      worktreeId: 'feature--test-branch',
      ports: { api: 10000, webapp: 10001 },
      urls: { api: 'http://127.0.0.1:10000', webapp: 'http://127.0.0.1:10001' },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };
    mockReadFileSync.mockReturnValue(JSON.stringify(state));

    const result = await loadOrCreateState(makeConfig());

    expect(mockLock).toHaveBeenCalledWith('/tmp/test-repo/.grove/feature--test-branch.json', expect.objectContaining({ retries: expect.any(Object) }));
    expect(result).toEqual(state);
    expect(mockRelease).toHaveBeenCalled();
  });

  it('creates new state with allocated ports when no file exists', async () => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);

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
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
    mockExecSync.mockReturnValue('feature/auth-fix');

    const result = await loadOrCreateState(makeConfig());

    expect(result.namespace).toBe('testapp-feature--auth-fix');
    expect(result.worktreeId).toBe('feature--auth-fix');
  });

  it('generates correct URLs for services and frontends', async () => {
    mockExistsSync.mockReturnValue(false);
    mockReaddirSync.mockReturnValue([]);
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

  it('falls back to creating new state when loading fails', async () => {
    mockExistsSync.mockReturnValue(true);
    // First lock call (loading existing state) fails; subsequent calls (sentinel + writeState) succeed
    mockLock.mockRejectedValueOnce(new Error('Lock failed'));
    mockReaddirSync.mockReturnValue([]);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await loadOrCreateState(makeConfig());

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load state, creating new'));
    expect(result.ports).toBeDefined();

    consoleWarnSpy.mockRestore();
  });
});

describe('writeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRelease.mockResolvedValue(undefined);
    mockLock.mockResolvedValue(mockRelease);
  });

  it('writes state to the correct file path', async () => {
    mockExistsSync.mockReturnValue(true);
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

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/test-repo/.grove/test-branch.json',
      expect.stringContaining('"namespace": "testapp-test-branch"'),
      'utf-8'
    );
  });

  it('creates the .grove directory if needed', async () => {
    mockExistsSync.mockReturnValue(false);
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

    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/test-repo/.grove', { recursive: true });
  });

  it('creates the file if it does not exist before locking', async () => {
    const calls: Array<{ path: string, value: boolean }> = [];
    mockExistsSync.mockImplementation((path: string) => {
      const value = calls.length > 0 && calls[0].path === path;
      calls.push({ path: path as string, value });
      return value;
    });

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

    const emptyCalls = mockWriteFileSync.mock.calls.filter(call => call[1] === '{}');
    expect(emptyCalls.length).toBeGreaterThan(0);
  });

  it('updates lastEnsure timestamp', async () => {
    mockExistsSync.mockReturnValue(true);
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

    const writtenContent = mockWriteFileSync.mock.calls.find(call =>
      typeof call[1] === 'string' && call[1].includes('"namespace"')
    )?.[1];

    expect(writtenContent).toBeDefined();
    const parsed = JSON.parse(writtenContent as string);
    expect(parsed.lastEnsure).not.toBe('2026-02-11T10:00:00Z');
    expect(new Date(parsed.lastEnsure).getTime()).toBeGreaterThan(new Date('2026-02-11T10:00:00Z').getTime());
  });

  it('throws when lock fails', async () => {
    mockExistsSync.mockReturnValue(true);
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

    await expect(writeState(state, makeConfig())).rejects.toThrow('Failed to write state');
  });
});
