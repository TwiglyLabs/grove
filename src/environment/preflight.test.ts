import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('./state.js', () => ({
  readState: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../shared/output.js', () => ({
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
}));

import { runPreflightChecks } from './preflight.js';
import { readState } from './state.js';
import { printSuccess, printWarning } from '../shared/output.js';
import { PreflightFailedError } from '../shared/errors.js';

const testConfig = {
  project: { name: 'test', cluster: 'test', clusterType: 'kind' as const },
  helm: { chart: '.', release: 'test', valuesFiles: [] },
  services: [],
  portBlockSize: 0,
  repoRoot: '/tmp/test',
} as any;

describe('runPreflightChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readState).mockResolvedValue(null);
  });

  it('passes when all tools are available', async () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    const result = await runPreflightChecks(testConfig);

    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  it('fails when docker is not available and throws PreflightFailedError', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'docker info') {
        throw new Error('docker: command not found');
      }
      return Buffer.from('');
    });

    await expect(runPreflightChecks(testConfig)).rejects.toThrow(PreflightFailedError);

    try {
      await runPreflightChecks(testConfig);
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightFailedError);
      const preflightErr = err as PreflightFailedError;
      const dockerCheck = preflightErr.checks.find((c) => c.name === 'docker');
      expect(dockerCheck).toBeDefined();
    }
  });

  it('fails when kubectl is missing and throws PreflightFailedError', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'kubectl version --client') {
        throw new Error('kubectl: command not found');
      }
      return Buffer.from('');
    });

    await expect(runPreflightChecks(testConfig)).rejects.toThrow(PreflightFailedError);

    try {
      await runPreflightChecks(testConfig);
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightFailedError);
      const preflightErr = err as PreflightFailedError;
      const kubectlCheck = preflightErr.checks.find((c) => c.name === 'kubectl');
      expect(kubectlCheck).toBeDefined();
    }
  });

  it('fails when helm is missing and throws PreflightFailedError', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'helm version --short') {
        throw new Error('helm: command not found');
      }
      return Buffer.from('');
    });

    await expect(runPreflightChecks(testConfig)).rejects.toThrow(PreflightFailedError);

    try {
      await runPreflightChecks(testConfig);
    } catch (err) {
      expect(err).toBeInstanceOf(PreflightFailedError);
      const preflightErr = err as PreflightFailedError;
      const helmCheck = preflightErr.checks.find((c) => c.name === 'helm');
      expect(helmCheck).toBeDefined();
    }
  });

  it('checks kind when clusterType is kind', async () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    await runPreflightChecks(testConfig);

    const kindCalls = mockExecSync.mock.calls.filter((call: string[]) => call[0] === 'kind version');
    expect(kindCalls.length).toBeGreaterThan(0);
  });

  it('checks k3d when clusterType is k3s', async () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    const k3sConfig = {
      ...testConfig,
      project: { ...testConfig.project, clusterType: 'k3s' as const },
    };

    await runPreflightChecks(k3sConfig);

    const k3dCalls = mockExecSync.mock.calls.filter((call: string[]) => call[0] === 'k3d version');
    expect(k3dCalls.length).toBeGreaterThan(0);
  });

  it('throws PreflightFailedError with details about all failed checks', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'docker info' || cmd === 'kubectl version --client') {
        throw new Error('command not found');
      }
      return Buffer.from('');
    });

    let thrownError: unknown;
    try {
      await runPreflightChecks(testConfig);
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(PreflightFailedError);
    const preflightErr = thrownError as PreflightFailedError;
    expect(preflightErr.code).toBe('PREFLIGHT_FAILED');
    expect(preflightErr.checks.length).toBeGreaterThanOrEqual(2);
    expect(preflightErr.checks.some((c) => c.name === 'docker')).toBe(true);
    expect(preflightErr.checks.some((c) => c.name === 'kubectl')).toBe(true);
  });

  it('prints success for passing checks and warning for failing checks', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'docker info') {
        throw new Error('docker not running');
      }
      return Buffer.from('');
    });

    try {
      await runPreflightChecks(testConfig);
    } catch {
      // expected
    }

    expect(printSuccess).toHaveBeenCalled();
    expect(printWarning).toHaveBeenCalled();
  });

  it('passes timeout option to execSync', async () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    await runPreflightChecks(testConfig);

    // Every execSync call should include a timeout option
    for (const call of mockExecSync.mock.calls) {
      expect(call[1]).toHaveProperty('timeout', 5000);
    }
  });

  it('treats command timeout as a failed check', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'docker info') {
        const err = new Error('Command timed out');
        (err as any).killed = true;
        throw err;
      }
      return Buffer.from('');
    });

    await expect(runPreflightChecks(testConfig)).rejects.toThrow(PreflightFailedError);
  });

  it('skips port checks when no state file exists', async () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    vi.mocked(readState).mockResolvedValue(null);

    const result = await runPreflightChecks(testConfig);

    expect(result.passed).toBe(true);
    // No port checks in the results when state is null
    const portChecks = result.checks.filter((c) => c.name.startsWith('port-'));
    expect(portChecks).toHaveLength(0);
  });
});
