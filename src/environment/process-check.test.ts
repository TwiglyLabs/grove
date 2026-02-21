import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { isProcessRunning, isGroveProcess } from './process-check.js';

describe('isProcessRunning', () => {
  it('returns true for the current process', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
  });

  it('returns false for a non-existent PID', () => {
    expect(isProcessRunning(2147483647)).toBe(false);
  });
});

describe('isGroveProcess', () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    killSpy = vi.spyOn(process, 'kill');
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  it('returns false when process is not running', () => {
    killSpy.mockImplementation(() => { throw new Error('ESRCH'); });

    expect(isGroveProcess(99999)).toBe(false);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('returns true when ps reports kubectl', () => {
    killSpy.mockImplementation(() => true);
    mockExecSync.mockReturnValue('kubectl\n');

    expect(isGroveProcess(12345)).toBe(true);
  });

  it('returns true when ps reports node', () => {
    killSpy.mockImplementation(() => true);
    mockExecSync.mockReturnValue('node\n');

    expect(isGroveProcess(12345)).toBe(true);
  });

  it('returns false when PID belongs to unrelated process (PID reuse)', () => {
    killSpy.mockImplementation(() => true);
    mockExecSync.mockReturnValue('postgres\n');

    expect(isGroveProcess(12345)).toBe(false);
  });

  it('returns false for system daemon PID reuse', () => {
    killSpy.mockImplementation(() => true);
    mockExecSync.mockReturnValue('launchd\n');

    expect(isGroveProcess(12345)).toBe(false);
  });

  it('falls back to true when ps command fails', () => {
    killSpy.mockImplementation(() => true);
    mockExecSync.mockImplementation(() => { throw new Error('ps failed'); });

    // If we can't determine the process name, assume it's ours (fail-open)
    expect(isGroveProcess(12345)).toBe(true);
  });

  it('checks all grove commands', () => {
    killSpy.mockImplementation(() => true);

    for (const cmd of ['kubectl', 'node', 'npm', 'npx', 'bash', 'sh', 'sleep']) {
      mockExecSync.mockReturnValue(`${cmd}\n`);
      expect(isGroveProcess(12345)).toBe(true);
    }
  });
});
