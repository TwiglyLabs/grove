import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.js', () => ({
  readLogs: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('../environment/state.js', () => ({
  readState: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printWarning: vi.fn(),
  printError: vi.fn(),
}));

import { logsCommand } from './cli.js';
import { readLogs } from './api.js';
import { load as loadConfig } from '../shared/config.js';
import { readState } from '../environment/state.js';
import { spawn } from 'child_process';
import { printWarning, printError } from '../shared/output.js';
import { asRepoId } from '../shared/identity.js';
import type { GroveConfig } from '../config.js';

const testRepoId = asRepoId('repo_test123');

const mockConfig = {
  project: { name: 'test-app', cluster: 'test-cluster' },
  repoRoot: '/tmp/test-repo',
  services: [],
  helm: { chart: 'test', release: 'test', valuesFiles: [] },
  portBlockSize: 5,
} as unknown as GroveConfig;

describe('logsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
  });

  describe('file-based logs (default)', () => {
    it('prints log content when found', async () => {
      vi.mocked(readLogs).mockResolvedValue({
        service: 'api',
        type: 'port-forward',
        content: 'log output here',
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await logsCommand(testRepoId, 'api');

      expect(readLogs).toHaveBeenCalledWith(testRepoId, 'api');
      expect(logSpy).toHaveBeenCalledWith('log output here');
    });

    it('prints error when no logs found', async () => {
      vi.mocked(readLogs).mockResolvedValue(null);

      await logsCommand(testRepoId, 'api');

      expect(printError).toHaveBeenCalledWith('No logs found for service: api');
    });
  });

  describe('pod logs (--pod)', () => {
    it('warns and returns when no state exists', async () => {
      vi.mocked(readState).mockReturnValue(null);

      await logsCommand(testRepoId, 'api', ['--pod']);

      expect(printWarning).toHaveBeenCalledWith('No state file found - environment is not running');
    });

    it('spawns kubectl logs with correct args when state exists', async () => {
      vi.mocked(readState).mockReturnValue({
        namespace: 'test-app-main',
        branch: 'main',
        worktreeId: 'main',
        ports: {},
        urls: {},
        processes: {},
        lastEnsure: new Date().toISOString(),
      });

      const mockProc = { on: vi.fn() };
      vi.mocked(spawn).mockReturnValue(mockProc as any);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      // Don't await — the promise never resolves
      logsCommand(testRepoId, 'api', ['--pod']);

      // Wait a tick for the async code to execute
      await new Promise(r => setTimeout(r, 10));

      expect(spawn).toHaveBeenCalledWith(
        'kubectl',
        ['logs', '-n', 'test-app-main', '-l', 'app=api', '-f', '--tail=100'],
        { stdio: 'inherit' },
      );
    });
  });
});
