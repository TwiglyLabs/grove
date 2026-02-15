import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(),
}));

vi.mock('../state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('../output.js', () => ({
  printError: vi.fn(),
}));

import { spawn, execSync } from 'child_process';
import { shellCommand } from './shell.js';
import { readState } from '../state.js';
import { printError } from '../output.js';
import { ExitError, mockProcessExit } from '../testing/test-helpers.js';
import type { GroveConfig } from '../config.js';

const mockConfig = {
  project: { name: 'test-app', cluster: 'test-cluster' },
  repoRoot: '/tmp/test-repo',
  utilities: {
    shellTargets: [
      { name: 'api' },
      { name: 'auth', podSelector: 'component=auth-server' },
      { name: 'worker', shell: '/bin/bash' },
    ],
  },
  services: [],
  helm: { chart: 'test', release: 'test', valuesFiles: [] },
  portBlockSize: 5,
} as unknown as GroveConfig;

const mockState = {
  namespace: 'test-app-main',
  branch: 'main',
  worktreeId: 'main',
  ports: {},
  urls: {},
  processes: {},
  lastEnsure: new Date().toISOString(),
};

describe('shellCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessExit();
  });

  it('prints error when no service specified', async () => {
    await expect(shellCommand(mockConfig, undefined)).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Usage: grove shell <service>');
  });

  it('prints error for unknown service', async () => {
    await expect(shellCommand(mockConfig, 'database')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: database');
  });

  it('prints error when environment not running', async () => {
    vi.mocked(readState).mockReturnValue(null);

    await expect(shellCommand(mockConfig, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Dev environment not running. Run `grove up` first.');
  });

  it('uses default pod selector when not specified', async () => {
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(execSync).mockReturnValue('api-pod-abc123');

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    // Don't await — the promise never resolves
    shellCommand(mockConfig, 'api');

    // Wait a tick for the sync code to execute
    await new Promise(r => setTimeout(r, 10));

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('-l app=api'),
      expect.any(Object)
    );
  });

  it('uses custom pod selector when specified', async () => {
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(execSync).mockReturnValue('auth-pod-abc123');

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    shellCommand(mockConfig, 'auth');
    await new Promise(r => setTimeout(r, 10));

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('-l component=auth-server'),
      expect.any(Object)
    );
  });

  it('uses default shell /bin/sh when not specified', async () => {
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(execSync).mockReturnValue('api-pod-abc123');

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    shellCommand(mockConfig, 'api');
    await new Promise(r => setTimeout(r, 10));

    expect(spawn).toHaveBeenCalledWith(
      'kubectl',
      expect.arrayContaining(['--', '/bin/sh']),
      expect.any(Object)
    );
  });

  it('uses custom shell when specified', async () => {
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(execSync).mockReturnValue('worker-pod-abc123');

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    shellCommand(mockConfig, 'worker');
    await new Promise(r => setTimeout(r, 10));

    expect(spawn).toHaveBeenCalledWith(
      'kubectl',
      expect.arrayContaining(['--', '/bin/bash']),
      expect.any(Object)
    );
  });

  it('passes correct namespace to kubectl', async () => {
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(execSync).mockReturnValue('api-pod-abc123');

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    shellCommand(mockConfig, 'api');
    await new Promise(r => setTimeout(r, 10));

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('-n test-app-main'),
      expect.any(Object)
    );
  });

  it('prints error when no pod found', async () => {
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(execSync).mockReturnValue('');

    await expect(shellCommand(mockConfig, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('No running pod found for api');
  });

  it('handles config with no shellTargets', async () => {
    const configNoTargets = {
      ...mockConfig,
      utilities: {},
    } as unknown as GroveConfig;

    await expect(shellCommand(configNoTargets, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: api');
  });

  it('handles config with no utilities section', async () => {
    const configNoUtils = {
      ...mockConfig,
      utilities: undefined,
    } as unknown as GroveConfig;

    await expect(shellCommand(configNoUtils, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: api');
  });
});
