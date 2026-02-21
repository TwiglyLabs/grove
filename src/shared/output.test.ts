import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatAge,
  jsonSuccess,
  jsonError,
  printDashboard,
  printTestResult,
  printTestFailures,
} from './output.js';
import type { DashboardData } from './output.js';
import type { TestResult, FailureDetail } from '../testing/types.js';

describe('output', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('jsonSuccess', () => {
    it('outputs success envelope', () => {
      jsonSuccess({ id: 'test', value: 42 });
      const output = consoleSpy.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed).toEqual({ ok: true, data: { id: 'test', value: 42 } });
    });
  });

  describe('jsonError', () => {
    it('outputs error envelope and sets exit code', () => {
      const originalExitCode = process.exitCode;
      jsonError('something failed');
      const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed).toEqual({ ok: false, error: 'something failed' });
      expect(process.exitCode).toBe(1);
      process.exitCode = originalExitCode;
    });

    it('includes data when provided', () => {
      const originalExitCode = process.exitCode;
      jsonError('conflicts', { files: ['a.ts', 'b.ts'] });
      const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed).toEqual({
        ok: false,
        error: 'conflicts',
        data: { files: ['a.ts', 'b.ts'] },
      });
      process.exitCode = originalExitCode;
    });
  });

  describe('formatAge', () => {
    it('returns minutes for recent dates', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      expect(formatAge(fiveMinutesAgo)).toBe('5m');
    });

    it('returns hours for dates hours ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
      expect(formatAge(threeHoursAgo)).toBe('3h');
    });

    it('returns days for dates days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      expect(formatAge(twoDaysAgo)).toBe('2d');
    });

    it('returns 0m for now', () => {
      expect(formatAge(new Date())).toBe('0m');
    });
  });

  describe('printDashboard', () => {
    const baseDashboard: DashboardData = {
      state: 'healthy',
      namespace: 'test-app-main',
      branch: 'main',
      worktreeId: 'main',
      lastEnsure: new Date().toISOString(),
      health: {
        namespace: 'test-app-main',
        healthy: true,
        pods: [
          { app: 'api', ready: true, phase: 'Running' },
          { app: 'auth', ready: true, phase: 'Running' },
        ],
      },
      portForwards: [
        { port: 10000, service: 'api', healthy: true },
        { port: 10001, service: 'auth', healthy: true },
      ],
      processes: [],
      urls: { api: 'http://127.0.0.1:10000', auth: 'http://127.0.0.1:10001' },
    };

    it('prints healthy dashboard', () => {
      printDashboard(baseDashboard);

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Environment Status');
      expect(allOutput).toContain('test-app-main');
      expect(allOutput).toContain('main');
      expect(allOutput).toContain('Services');
      expect(allOutput).toContain('api');
      expect(allOutput).toContain('Port Forwards');
      expect(allOutput).toContain(':10000');
      expect(allOutput).toContain('URLs');
    });

    it('prints degraded state', () => {
      printDashboard({ ...baseDashboard, state: 'degraded' });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('DEGRADED');
    });

    it('prints error state', () => {
      printDashboard({ ...baseDashboard, state: 'error' });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('ERROR');
    });

    it('prints processes when present', () => {
      printDashboard({
        ...baseDashboard,
        processes: [
          { name: 'metro', pid: 12345, startedAt: new Date().toISOString(), running: true },
        ],
      });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Processes');
      expect(allOutput).toContain('metro');
      expect(allOutput).toContain('pid:12345');
    });

    it('prints startup history when present', () => {
      printDashboard({
        ...baseDashboard,
        startupHistory: [
          { timestamp: new Date().toISOString(), type: 'warm', duration: 1500 },
          { timestamp: new Date().toISOString(), type: 'cold', duration: 45000 },
        ],
      });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Recent Startups');
      expect(allOutput).toContain('warm');
      expect(allOutput).toContain('cold');
    });

    it('handles empty pods list', () => {
      printDashboard({
        ...baseDashboard,
        health: { ...baseDashboard.health, pods: [] },
      });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('No pods found');
    });
  });

  describe('printTestResult', () => {
    const baseResult: TestResult = {
      run: {
        id: 'test-123',
        platform: 'api',
        suite: 'default',
        duration: '12.3s',
        result: 'pass',
      },
      environment: {
        worktree: 'main',
        namespace: 'test-app-main',
      },
      tests: {
        passed: 10,
        failed: 0,
        skipped: 2,
        total: 12,
      },
      failures: [],
      artifacts: {},
      logs: {
        stdout: '/tmp/stdout.log',
        stderr: '/tmp/stderr.log',
      },
    };

    it('prints passing result', () => {
      printTestResult(baseResult);

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('Test Results');
      expect(allOutput).toContain('PASS');
      expect(allOutput).toContain('12.3s');
      expect(allOutput).toContain('10');
    });

    it('prints failing result', () => {
      printTestResult({
        ...baseResult,
        run: { ...baseResult.run, result: 'fail' },
        tests: { passed: 8, failed: 2, skipped: 0, total: 10 },
      });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('FAIL');
    });

    it('prints timeout result', () => {
      printTestResult({
        ...baseResult,
        run: { ...baseResult.run, result: 'timeout' },
      });

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('TIMEOUT');
    });
  });

  describe('printTestFailures', () => {
    it('prints failure details', () => {
      const failures: FailureDetail[] = [
        {
          test: 'should create task',
          message: 'Expected 200 but got 500',
          file: 'tests/task.test.ts',
          line: 42,
        },
        {
          test: 'should delete task',
          message: 'Timeout exceeded',
        },
      ];

      printTestFailures(failures);

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('should create task');
      expect(allOutput).toContain('Expected 200 but got 500');
      expect(allOutput).toContain('tests/task.test.ts:42');
      expect(allOutput).toContain('should delete task');
      expect(allOutput).toContain('Timeout exceeded');
    });

    it('does nothing for empty failures array', () => {
      const callsBefore = consoleSpy.mock.calls.length;
      printTestFailures([]);
      expect(consoleSpy.mock.calls.length).toBe(callsBefore);
    });

    it('handles failure without file info', () => {
      const failures: FailureDetail[] = [
        {
          test: 'some test',
          message: 'assertion failed',
        },
      ];

      printTestFailures(failures);

      const allOutput = consoleSpy.mock.calls.map(c => c[0]).join('\n');
      expect(allOutput).toContain('some test');
      expect(allOutput).toContain('assertion failed');
    });
  });
});
