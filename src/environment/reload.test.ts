import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('./state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printError: vi.fn(),
  printBanner: vi.fn(),
  printUrlTable: vi.fn(),
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
  printDashboard: vi.fn(),
}));

import { writeFileSync } from 'fs';
import { reloadCommand } from './cli.js';
import { load as loadConfig } from '../shared/config.js';
import { readState } from './state.js';
import { printError } from '../shared/output.js';
import { ExitError, mockProcessExit } from '../testing/test-helpers.js';
import { asRepoId } from '../shared/identity.js';
import type { GroveConfig } from '../config.js';

const testRepoId = asRepoId('repo_test123');

const mockConfig = {
  project: { name: 'test-app', cluster: 'test-cluster' },
  repoRoot: '/tmp/test-repo',
  utilities: {
    reloadTargets: ['api', 'auth', 'worker'],
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

describe('reloadCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessExit();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    vi.mocked(readState).mockReturnValue(mockState);
  });

  it('prints error when no service specified', async () => {
    await expect(reloadCommand(testRepoId, undefined)).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Usage: grove reload <service>');
  });

  it('prints error for unknown service', async () => {
    await expect(reloadCommand(testRepoId, 'database')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: database');
  });

  it('prints error when environment not running', async () => {
    vi.mocked(readState).mockReturnValue(null);

    await expect(reloadCommand(testRepoId, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Dev environment not running. Run `grove up` first.');
  });

  it('writes reload request file for valid service', async () => {
    await reloadCommand(testRepoId, 'api');

    expect(writeFileSync).toHaveBeenCalledWith(
      '/tmp/test-repo/.reload-request',
      'api\n'
    );
  });

  it('accepts all configured reload targets', async () => {
    for (const target of ['api', 'auth', 'worker']) {
      vi.clearAllMocks();
      mockProcessExit();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(readState).mockReturnValue(mockState);

      await reloadCommand(testRepoId, target);

      expect(writeFileSync).toHaveBeenCalledWith(
        '/tmp/test-repo/.reload-request',
        `${target}\n`
      );
    }
  });

  it('handles config with no reloadTargets', async () => {
    const configNoTargets = {
      ...mockConfig,
      utilities: {},
    } as unknown as GroveConfig;
    vi.mocked(loadConfig).mockResolvedValue(configNoTargets);

    await expect(reloadCommand(testRepoId, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: api');
  });

  it('handles config with no utilities section', async () => {
    const configNoUtils = {
      ...mockConfig,
      utilities: undefined,
    } as unknown as GroveConfig;
    vi.mocked(loadConfig).mockResolvedValue(configNoUtils);

    await expect(reloadCommand(testRepoId, 'api')).rejects.toThrow(ExitError);

    expect(printError).toHaveBeenCalledWith('Unknown service: api');
  });
});
