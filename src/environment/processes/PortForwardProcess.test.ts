import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PortForwardConfig } from './PortForwardProcess.js';

const mockSpawn = vi.fn();
const mockOpenSync = vi.fn();
const mockCloseSync = vi.fn();
const mockExistsSync = vi.fn().mockReturnValue(true);
const mockMkdirSync = vi.fn();
const mockCheckTcpReady = vi.fn();

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
  checkTcpReady: (...args: unknown[]) => mockCheckTcpReady(...args),
}));

import { PortForwardProcess } from './PortForwardProcess.js';
import { PortForwardFailedError } from '../../shared/errors.js';

function makePfConfig(overrides?: Partial<PortForwardConfig>): PortForwardConfig {
  return {
    namespace: 'test-ns',
    serviceName: 'api',
    remotePort: 3000,
    localPort: 10000,
    hostIp: '127.0.0.1',
    ...overrides,
  };
}

function makeChildProcess(pid: number | undefined) {
  return {
    pid,
    unref: vi.fn(),
    on: vi.fn(),
  };
}

describe('PortForwardProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenSync.mockReturnValueOnce(10).mockReturnValueOnce(11); // FD numbers
  });

  describe('start — happy path', () => {
    it('returns ProcessInfo with pid and startedAt', async () => {
      mockSpawn.mockReturnValue(makeChildProcess(42));
      mockCheckTcpReady.mockResolvedValue(true);

      const pf = new PortForwardProcess(makePfConfig());
      const info = await pf.start('/tmp/logs');

      expect(info.pid).toBe(42);
      expect(info.startedAt).toBeTruthy();
    });

    it('closes both FDs after spawn', async () => {
      mockSpawn.mockReturnValue(makeChildProcess(42));
      mockCheckTcpReady.mockResolvedValue(true);

      const pf = new PortForwardProcess(makePfConfig());
      await pf.start('/tmp/logs');

      expect(mockCloseSync).toHaveBeenCalledWith(10);
      expect(mockCloseSync).toHaveBeenCalledWith(11);
    });
  });

  describe('start — spawn throws', () => {
    it('closes FDs even when spawn() throws', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('EMFILE: too many open files');
      });

      const pf = new PortForwardProcess(makePfConfig());
      await expect(pf.start('/tmp/logs')).rejects.toThrow('EMFILE');

      // FDs must still be closed
      expect(mockCloseSync).toHaveBeenCalledWith(10);
      expect(mockCloseSync).toHaveBeenCalledWith(11);
    });
  });

  describe('start — undefined pid', () => {
    it('throws PortForwardFailedError when child.pid is undefined', async () => {
      mockSpawn.mockReturnValue(makeChildProcess(undefined));

      const pf = new PortForwardProcess(makePfConfig());
      await expect(pf.start('/tmp/logs')).rejects.toThrow(PortForwardFailedError);

      // FDs still closed
      expect(mockCloseSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('start — TCP readiness failure', () => {
    it('throws PortForwardFailedError when port never becomes ready', async () => {
      const mockKill = vi.spyOn(process, 'kill').mockImplementation(() => true);
      mockSpawn.mockReturnValue(makeChildProcess(42));
      mockCheckTcpReady.mockResolvedValue(false);

      const pf = new PortForwardProcess(makePfConfig());
      await expect(pf.start('/tmp/logs')).rejects.toThrow(PortForwardFailedError);

      // Should attempt to kill the orphaned process
      expect(mockKill).toHaveBeenCalledWith(42, 'SIGTERM');

      mockKill.mockRestore();
    });
  });
});
