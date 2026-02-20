import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../api/shell.js', () => ({
  getShellCommand: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printError: vi.fn(),
}));

import { spawn } from 'child_process';
import { shellCommand } from './shell.js';
import { getShellCommand } from '../api/shell.js';
import { load as loadConfig } from '../shared/config.js';
import { printError } from '../shared/output.js';
import { ExitError, mockProcessExit } from '../testing/test-helpers.js';
import { EnvironmentNotRunningError, PodNotFoundError } from '../shared/errors.js';
import { asRepoId } from '../shared/identity.js';
import type { GroveConfig } from '../config.js';

const testRepoId = asRepoId('repo_test123');

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

describe('shellCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessExit();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
  });

  it('prints error when no service specified', async () => {
    await expect(shellCommand(testRepoId, undefined)).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Usage: grove shell <service>');
  });

  it('prints error for unknown service', async () => {
    vi.mocked(getShellCommand).mockRejectedValue(new Error('Unknown shell target: database'));

    await expect(shellCommand(testRepoId, 'database')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: database');
  });

  it('prints error when environment not running', async () => {
    vi.mocked(getShellCommand).mockRejectedValue(new EnvironmentNotRunningError());

    await expect(shellCommand(testRepoId, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Dev environment not running. Run `grove up` first.');
  });

  it('prints error when no pod found', async () => {
    vi.mocked(getShellCommand).mockRejectedValue(new PodNotFoundError('api'));

    await expect(shellCommand(testRepoId, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('No running pod found for api');
  });

  it('spawns kubectl with correct command', async () => {
    const mockCmd = {
      command: 'kubectl',
      args: ['exec', '-it', 'api-pod-abc123', '-n', 'test-app-main', '--', '/bin/sh'],
    };
    vi.mocked(getShellCommand).mockResolvedValue(mockCmd);

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    // Don't await — the promise never resolves
    shellCommand(testRepoId, 'api');

    // Wait a tick for the sync code to execute
    await new Promise(r => setTimeout(r, 10));

    expect(spawn).toHaveBeenCalledWith('kubectl', mockCmd.args, { stdio: 'inherit' });
  });

  it('calls getShellCommand with correct params', async () => {
    const mockCmd = {
      command: 'kubectl',
      args: ['exec', '-it', 'auth-pod-abc123', '-n', 'test-app-main', '--', '/bin/sh'],
    };
    vi.mocked(getShellCommand).mockResolvedValue(mockCmd);

    const mockProc = { on: vi.fn() };
    vi.mocked(spawn).mockReturnValue(mockProc as any);

    shellCommand(testRepoId, 'auth');
    await new Promise(r => setTimeout(r, 10));

    expect(getShellCommand).toHaveBeenCalledWith(testRepoId, 'auth');
  });

  it('shows available services when no service specified', async () => {
    let logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await expect(shellCommand(testRepoId, undefined)).rejects.toThrow(ExitError);

    expect(logged.some(l => l.includes('api'))).toBe(true);
    expect(logged.some(l => l.includes('auth'))).toBe(true);
    expect(logged.some(l => l.includes('worker'))).toBe(true);
  });

  it('shows available services on unknown service error', async () => {
    vi.mocked(getShellCommand).mockRejectedValue(new Error('Unknown shell target: database'));

    let logged: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });

    await expect(shellCommand(testRepoId, 'database')).rejects.toThrow(ExitError);

    expect(logged.some(l => l.includes('api'))).toBe(true);
    expect(logged.some(l => l.includes('auth'))).toBe(true);
    expect(logged.some(l => l.includes('worker'))).toBe(true);
  });
});
