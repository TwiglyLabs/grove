import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecSync = vi.hoisted(() => vi.fn());

vi.mock('../shared/output.js', () => ({
  printInfo: vi.fn(),
  printSuccess: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { runPreDeployHooks } from './hooks.js';
import { HookFailedError } from '../shared/errors.js';
import type { GroveConfig } from '../config.js';

function makeConfig(hooks?: GroveConfig['hooks']): GroveConfig {
  return {
    repoRoot: '/tmp/test-repo',
    portBlockSize: 10,
    project: { name: 'test', cluster: 'test-cluster', clusterType: 'kind' },
    helm: { chart: './chart', release: 'test', valuesFiles: ['values.yaml'] },
    services: [{ name: 'api' }],
    hooks,
  } as GroveConfig;
}

describe('runPreDeployHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when hooks is undefined', () => {
    runPreDeployHooks(makeConfig());
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('is a no-op when pre-deploy array is empty', () => {
    runPreDeployHooks(makeConfig({ 'pre-deploy': [] }));
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('executes hooks in order', () => {
    const calls: string[] = [];
    mockExecSync.mockImplementation((cmd: string) => {
      calls.push(cmd);
    });

    runPreDeployHooks(makeConfig({
      'pre-deploy': [
        { name: 'First', command: 'echo first' },
        { name: 'Second', command: 'echo second' },
      ],
    }));

    expect(calls).toEqual(['echo first', 'echo second']);
  });

  it('passes correct cwd and stdio options', () => {
    runPreDeployHooks(makeConfig({
      'pre-deploy': [
        { name: 'Test', command: 'echo test' },
      ],
    }));

    expect(mockExecSync).toHaveBeenCalledWith('echo test', {
      stdio: 'inherit',
      cwd: '/tmp/test-repo',
    });
  });

  it('throws HookFailedError on command failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command failed');
    });

    expect(() => runPreDeployHooks(makeConfig({
      'pre-deploy': [
        { name: 'Failing hook', command: 'exit 1' },
      ],
    }))).toThrow(HookFailedError);
  });

  it('includes hook name in the error', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('command failed');
    });

    try {
      runPreDeployHooks(makeConfig({
        'pre-deploy': [
          { name: 'Generate CRDs', command: 'exit 1' },
        ],
      }));
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HookFailedError);
      expect((error as HookFailedError).hookName).toBe('Generate CRDs');
      expect((error as HookFailedError).code).toBe('HOOK_FAILED');
    }
  });

  it('fails fast — does not run subsequent hooks after failure', () => {
    let callCount = 0;
    mockExecSync.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        throw new Error('first hook failed');
      }
    });

    expect(() => runPreDeployHooks(makeConfig({
      'pre-deploy': [
        { name: 'First', command: 'fail' },
        { name: 'Second', command: 'echo ok' },
      ],
    }))).toThrow(HookFailedError);

    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });
});
