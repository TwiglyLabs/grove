import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSetupCommands, runHook } from './setup.js';

const { mockSpawnSync, mockExistsSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mockSpawnSync,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
  };
});

describe('runSetupCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs commands sequentially and returns results', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'installed\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: 'generated\n', stderr: '' });

    const results = runSetupCommands(['npm install', 'npm run codegen'], '/workspace/repo');

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      command: 'npm install',
      exitCode: 0,
      stdout: 'installed\n',
      stderr: '',
    });
    expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(results[1]).toMatchObject({
      command: 'npm run codegen',
      exitCode: 0,
      stdout: 'generated\n',
      stderr: '',
    });

    // Verify sequential execution with correct cwd
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync).toHaveBeenNthCalledWith(1, 'npm install', expect.objectContaining({
      cwd: '/workspace/repo',
      shell: true,
      encoding: 'utf-8',
    }));
    expect(mockSpawnSync).toHaveBeenNthCalledWith(2, 'npm run codegen', expect.objectContaining({
      cwd: '/workspace/repo',
    }));
  });

  it('fails fast on non-zero exit code', () => {
    mockSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'ok\n', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'error: failed\n' });

    const results = runSetupCommands(['npm install', 'npm run codegen', 'npm run build'], '/workspace/repo');

    // Should return 2 results — stopped after the failure
    expect(results).toHaveLength(2);
    expect(results[0].exitCode).toBe(0);
    expect(results[1].exitCode).toBe(1);
    expect(results[1].stderr).toBe('error: failed\n');

    // Third command should not run
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  it('returns empty array for empty commands', () => {
    const results = runSetupCommands([], '/workspace/repo');

    expect(results).toEqual([]);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('handles null status as exit code 1', () => {
    mockSpawnSync.mockReturnValue({ status: null, stdout: '', stderr: 'signal' });

    const results = runSetupCommands(['bad-cmd'], '/workspace/repo');

    expect(results).toHaveLength(1);
    expect(results[0].exitCode).toBe(1);
  });

  it('handles null stdout/stderr', () => {
    mockSpawnSync.mockReturnValue({ status: 0, stdout: null, stderr: null });

    const results = runSetupCommands(['cmd'], '/workspace/repo');

    expect(results[0].stdout).toBe('');
    expect(results[0].stderr).toBe('');
  });
});

describe('runHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs hook script and returns result', () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 0, stdout: 'hook done\n', stderr: '' });

    const result = runHook('./scripts/post-create.sh', '/workspace/root');

    expect(result).toMatchObject({
      command: './scripts/post-create.sh',
      exitCode: 0,
      stdout: 'hook done\n',
      stderr: '',
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      '/workspace/root/scripts/post-create.sh',
      expect.objectContaining({
        cwd: '/workspace/root',
        shell: true,
      }),
    );
  });

  it('throws when hook script does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => runHook('./scripts/missing.sh', '/workspace/root')).toThrow(
      'Hook script not found: /workspace/root/scripts/missing.sh',
    );

    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('returns non-zero exit code for failing hook', () => {
    mockExistsSync.mockReturnValue(true);
    mockSpawnSync.mockReturnValue({ status: 127, stdout: '', stderr: 'not found' });

    const result = runHook('./scripts/bad.sh', '/workspace/root');

    expect(result.exitCode).toBe(127);
    expect(result.stderr).toBe('not found');
  });
});
