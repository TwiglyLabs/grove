import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api.js', () => ({
  runTests: vi.fn(),
}));

vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('../shared/output.js', () => ({
  printError: vi.fn(),
  printTestResult: vi.fn(),
  printTestFailures: vi.fn(),
}));

import { testCommand } from './cli.js';
import { runTests } from './api.js';
import { load as loadConfig } from '../shared/config.js';
import { printError, printTestResult, printTestFailures } from '../shared/output.js';
import { ExitError, mockProcessExit } from './test-helpers.js';
import { asRepoId } from '../shared/identity.js';
import type { GroveConfig } from '../config.js';
import type { TestResult } from './types.js';

const testRepoId = asRepoId('repo_test123');

const mockConfig = {
  project: { name: 'test-app', cluster: 'test-cluster' },
  repoRoot: '/tmp/test-repo',
  testing: {
    mobile: { runner: 'maestro', basePath: 'tests/mobile' },
    webapp: { runner: 'playwright', cwd: 'packages/webapp' },
    api: { runner: 'jest', cwd: 'packages/api' },
  },
  services: [],
  helm: { chart: 'test', release: 'test', valuesFiles: [] },
  portBlockSize: 5,
} as unknown as GroveConfig;

const passingResult: TestResult = {
  run: { id: 'api-default-1', platform: 'api', suite: 'default', duration: '5.00s', result: 'pass' },
  environment: { worktree: 'main', namespace: 'test-ns' },
  tests: { passed: 10, failed: 0, skipped: 0, total: 10 },
  failures: [],
  artifacts: { screenshots: '', videos: '', reports: '' },
  logs: { stdout: '', stderr: '' },
};

const failingResult: TestResult = {
  run: { id: 'api-default-2', platform: 'api', suite: 'default', duration: '3.00s', result: 'fail' },
  environment: { worktree: 'main', namespace: 'test-ns' },
  tests: { passed: 8, failed: 2, skipped: 0, total: 10 },
  failures: [
    { test: 'should login', message: 'Expected 200 but got 401' },
  ],
  artifacts: { screenshots: '', videos: '', reports: '' },
  logs: { stdout: '', stderr: '' },
};

describe('testCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessExit();
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);
  });

  it('prints usage and exits when no platform specified', async () => {
    await expect(testCommand(testRepoId, [])).rejects.toThrow(ExitError);
    expect(printError).toHaveBeenCalledWith('Usage: grove test <mobile|webapp|api> [options]');
  });

  it('prints usage for invalid platform', async () => {
    await expect(testCommand(testRepoId, ['invalid'])).rejects.toThrow(ExitError);
    expect(printError).toHaveBeenCalledWith('Usage: grove test <mobile|webapp|api> [options]');
  });

  it('exits with 0 on passing tests', async () => {
    vi.mocked(runTests).mockResolvedValue(passingResult);

    await expect(testCommand(testRepoId, ['api'])).rejects.toThrow(ExitError);

    const exitError = await testCommand(testRepoId, ['api']).catch(e => e);
    expect(exitError).toBeInstanceOf(ExitError);
    expect((exitError as ExitError).code).toBe(0);
  });

  it('exits with 1 on failing tests', async () => {
    vi.mocked(runTests).mockResolvedValue(failingResult);

    const exitError = await testCommand(testRepoId, ['api']).catch(e => e);
    expect(exitError).toBeInstanceOf(ExitError);
    expect((exitError as ExitError).code).toBe(1);
  });

  it('prints test result and failures', async () => {
    vi.mocked(runTests).mockResolvedValue(failingResult);

    await testCommand(testRepoId, ['api']).catch(() => {});

    expect(printTestResult).toHaveBeenCalledWith(failingResult);
    expect(printTestFailures).toHaveBeenCalledWith(failingResult.failures);
  });

  it('outputs JSON with --json flag', async () => {
    vi.mocked(runTests).mockResolvedValue(passingResult);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await testCommand(testRepoId, ['api', '--json']).catch(() => {});

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(passingResult, null, 2));
    expect(printTestResult).not.toHaveBeenCalled();
  });

  it('passes options to runTests', async () => {
    vi.mocked(runTests).mockResolvedValue(passingResult);

    await testCommand(testRepoId, ['api', '--suite', 'smoke', '--grep', 'login', '--verbose', '--timeout', '60000']).catch(() => {});

    expect(runTests).toHaveBeenCalledWith(
      testRepoId,
      expect.objectContaining({
        platform: 'api',
        suite: 'smoke',
        grep: 'login',
        verbose: true,
        timeout: 60000,
      }),
    );
  });

  it('exits with 1 when platform config missing', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      ...mockConfig,
      testing: {},
    } as unknown as GroveConfig);

    const exitError = await testCommand(testRepoId, ['mobile']).catch(e => e);
    expect(exitError).toBeInstanceOf(ExitError);
    expect(printError).toHaveBeenCalledWith('No mobile testing configuration in .grove.yaml');
  });

  it('handles error result with exit code 2', async () => {
    const errorResult: TestResult = {
      ...passingResult,
      run: { ...passingResult.run, result: 'error' },
    };
    vi.mocked(runTests).mockResolvedValue(errorResult);

    const exitError = await testCommand(testRepoId, ['api']).catch(e => e);
    expect((exitError as ExitError).code).toBe(2);
  });

  it('handles timeout result with exit code 3', async () => {
    const timeoutResult: TestResult = {
      ...passingResult,
      run: { ...passingResult.run, result: 'timeout' },
    };
    vi.mocked(runTests).mockResolvedValue(timeoutResult);

    const exitError = await testCommand(testRepoId, ['api']).catch(e => e);
    expect((exitError as ExitError).code).toBe(3);
  });
});
