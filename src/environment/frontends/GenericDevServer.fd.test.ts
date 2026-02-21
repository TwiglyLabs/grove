import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSpawn = vi.fn();
const mockOpenSync = vi.fn();
const mockCloseSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockMkdirSync = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock('fs', () => ({
  openSync: (...args: unknown[]) => mockOpenSync(...args),
  closeSync: (...args: unknown[]) => mockCloseSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}));

vi.mock('../health.js', () => ({
  checkHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock('../template.js', () => ({
  resolveTemplates: vi.fn((env: Record<string, string>) => env),
}));

import { GenericDevServer } from './GenericDevServer.js';
import { FrontendStartFailedError } from '../../shared/errors.js';

function makeChildProcess(pid: number | undefined) {
  return {
    pid,
    unref: vi.fn(),
    on: vi.fn(),
  };
}

describe('GenericDevServer — FD safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenSync.mockReturnValueOnce(10).mockReturnValueOnce(11);
  });

  it('closes FDs even when spawn() throws', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('EMFILE: too many open files');
    });

    const server = new GenericDevServer(
      { name: 'test-app', command: 'sleep 10', cwd: '.' },
      3000,
    );

    await expect(server.start('/tmp/repo', '/tmp/logs')).rejects.toThrow('EMFILE');

    expect(mockCloseSync).toHaveBeenCalledWith(10);
    expect(mockCloseSync).toHaveBeenCalledWith(11);
  });

  it('closes FDs on happy path', async () => {
    const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
    mockSpawn.mockReturnValue(makeChildProcess(42));

    const server = new GenericDevServer(
      { name: 'test-app', command: 'sleep 10', cwd: '.' },
      3000,
    );

    const info = await server.start('/tmp/repo', '/tmp/logs');

    expect(info.pid).toBe(42);
    expect(mockCloseSync).toHaveBeenCalledWith(10);
    expect(mockCloseSync).toHaveBeenCalledWith(11);

    mockKill.mockRestore();
  });

  it('throws FrontendStartFailedError when child.pid is undefined', async () => {
    mockSpawn.mockReturnValue(makeChildProcess(undefined));

    const server = new GenericDevServer(
      { name: 'test-app', command: 'sleep 10', cwd: '.' },
      3000,
    );

    await expect(server.start('/tmp/repo', '/tmp/logs')).rejects.toThrow(FrontendStartFailedError);

    // FDs still closed
    expect(mockCloseSync).toHaveBeenCalledTimes(2);
  });
});
