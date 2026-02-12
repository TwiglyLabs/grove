import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'child_process';
import type { GroveConfig } from '../config.js';

const { mockSpawn, mockExecSync, mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockReaddirSync, mockUnlinkSync, mockRmdirSync, mockExistsSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockRmdirSync: vi.fn(),
  mockExistsSync: vi.fn(() => true),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
}));

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
    rmdirSync: mockRmdirSync,
    existsSync: mockExistsSync,
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  unlinkSync: mockUnlinkSync,
  rmdirSync: mockRmdirSync,
  existsSync: mockExistsSync,
}));

// Mock readState to return our test state
const mockReadState = vi.fn();
const mockEnsureEnvironment = vi.fn();

vi.mock('../state.js', () => ({
  readState: (...args: any[]) => mockReadState(...args),
}));

vi.mock('../controller.js', () => ({
  ensureEnvironment: (...args: any[]) => mockEnsureEnvironment(...args),
}));

vi.mock('../sanitize.js', () => ({
  sanitizeBranchName: vi.fn((b: string) => b.replace(/\//g, '--').toLowerCase()),
}));

vi.mock('../template.js', () => ({
  resolveTemplates: vi.fn((env: Record<string, string>) => env),
}));

vi.mock('./result-archive.js', () => ({
  archiveResults: vi.fn(),
}));

import { runTests } from './test-runner.js';

function makeConfig(overrides: Partial<GroveConfig> = {}): GroveConfig {
  return {
    project: { name: 'testapp', cluster: 'twiglylabs-local' },
    helm: { chart: 'chart', release: 'testapp', valuesFiles: ['values.yaml'] },
    services: [
      { name: 'api', build: { image: 'api', dockerfile: 'Dockerfile' }, portForward: { remotePort: 3001, hostIp: '0.0.0.0' }, health: { path: '/health', protocol: 'http' } },
    ],
    portBlockSize: 10,
    repoRoot: '/tmp/test-repo',
    testing: {
      mobile: {
        runner: 'maestro',
        basePath: 'src/e2e/mobile/maestro',
        suites: [{ name: 'smoke', paths: ['flows/smoke'] }],
        envVars: { API_URL: '{{urls.api}}' },
      },
      webapp: { runner: 'playwright', cwd: 'src/e2e/webapp' },
      api: { runner: 'vitest', cwd: 'src/e2e/api' },
      observability: { serviceName: 'testapp-api' },
      historyDir: '.grove/test-history',
      historyLimit: 10,
      defaultTimeout: 300000,
    },
    simulator: {
      platform: 'ios',
      bundleId: 'com.testapp.app',
      appName: 'TestApp',
      simulatorPrefix: 'TestApp',
      baseDevice: ['iPhone 15 Pro', 'iPhone 16 Pro'],
      deepLinkScheme: 'testapp',
      metroFrontend: 'mobile',
    },
    ...overrides,
  } as GroveConfig;
}

const defaultState = {
  namespace: 'testapp-test-branch',
  branch: 'test-branch',
  worktreeId: 'test-branch',
  ports: {
    api: 10000,
    auth: 10001,
    jaeger: 10004,
    mobile: 10007,
    webapp: 10008,
  },
  urls: {
    api: 'http://0.0.0.0:10000',
    auth: 'http://0.0.0.0:10001',
    jaeger: 'http://localhost:10004',
    mobile: 'http://0.0.0.0:10007',
    webapp: 'http://localhost:10008',
  },
  processes: {},
  lastEnsure: '2026-02-07T10:00:00Z',
  simulator: {
    udid: 'test-udid-123',
    name: 'TestApp-test-branch',
    basedOn: 'iPhone 15 Pro',
    status: 'booted' as const,
  },
};

describe('test-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadState.mockReturnValue(defaultState);
    mockExecSync.mockReturnValue('/tmp/test-repo');
    mockReaddirSync.mockReturnValue([]);
  });

  describe('suite mapping', () => {
    it('resolves named smoke suite from config for mobile', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'mobile', suite: 'smoke', noEnsure: true });

      expect(mockSpawn).toHaveBeenCalledWith(
        'maestro',
        expect.arrayContaining([
          'test',
          expect.stringContaining('flows/smoke'),
        ]),
        expect.any(Object)
      );
    });

    it('uses custom flow paths when provided for mobile', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), {
        platform: 'mobile',
        flow: ['custom/flow.yaml'],
        noEnsure: true
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'maestro',
        expect.arrayContaining([
          'test',
          expect.stringContaining('custom/flow.yaml'),
        ]),
        expect.any(Object)
      );
    });
  });

  describe('maestro command construction', () => {
    it('builds maestro command with device, output, format, and debug-output', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'mobile', suite: 'smoke', noEnsure: true });

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[0]).toBe('maestro');
      expect(spawnCall[1]).toEqual(
        expect.arrayContaining([
          'test',
          '--device', 'test-udid-123',
          '--output', expect.stringContaining('test-output/maestro'),
          '--format', 'junit',
          '--debug-output', expect.stringContaining('test-output/maestro'),
        ])
      );
    });
  });

  describe('playwright command construction', () => {
    it('builds playwright command with reporter and output directory', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'webapp', noEnsure: true });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--reporter=json',
          expect.stringMatching(/--output=/),
        ]),
        expect.any(Object)
      );
    });

    it('includes file filter when provided for webapp', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), {
        platform: 'webapp',
        file: 'auth.spec.ts',
        noEnsure: true
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          'auth.spec.ts',
        ]),
        expect.any(Object)
      );
    });

    it('includes grep filter when provided for webapp', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), {
        platform: 'webapp',
        grep: 'login flow',
        noEnsure: true
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'playwright',
          'test',
          '--grep=login flow',
        ]),
        expect.any(Object)
      );
    });
  });

  describe('vitest command construction', () => {
    it('builds vitest command with reporter and output file', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'vitest',
          'run',
          '--reporter=json',
          expect.stringMatching(/--outputFile=/),
        ]),
        expect.any(Object)
      );
    });

    it('includes AI tests when --ai flag is set', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', ai: true, noEnsure: true });

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2]?.env).toHaveProperty('INCLUDE_AI_TESTS', 'true');
    });

    it('sets API_URL from state when --use-dev is set', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', useDev: true, noEnsure: true });

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2]?.env).toHaveProperty('API_URL', 'http://0.0.0.0:10000');
    });

    it('skips globalSetup when --use-dev is set', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', useDev: true, noEnsure: true });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'vitest',
          'run',
          '--globalSetup=',
        ]),
        expect.any(Object)
      );
    });

    it('includes file filter when provided for api', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), {
        platform: 'api',
        file: 'tasks.test.ts',
        noEnsure: true
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'vitest',
          'run',
          'tasks.test.ts',
        ]),
        expect.any(Object)
      );
    });

    it('includes grep filter when provided for api', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), {
        platform: 'api',
        grep: 'create task',
        noEnsure: true
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'npx',
        expect.arrayContaining([
          'vitest',
          'run',
          '-t', 'create task',
        ]),
        expect.any(Object)
      );
    });
  });

  describe('process management', () => {
    it('kills process with SIGTERM on timeout', async () => {
      const mockProcess = createMockProcess(null);
      mockSpawn.mockReturnValue(mockProcess);

      const promise = runTests(makeConfig(), {
        platform: 'api',
        noEnsure: true,
        timeout: 100
      });

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    }, 10000);

    it('captures stdout and stderr to log files', async () => {
      const mockProcess = createMockProcess(0, 'test output', 'test error');
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('stdout.log'),
        expect.stringContaining('test output')
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('stderr.log'),
        expect.stringContaining('test error')
      );
    });
  });

  describe('result parsing', () => {
    it('parses JUnit XML for maestro test results', async () => {
      const junitXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="maestro" tests="5" failures="1" errors="0" skipped="0">
    <testcase name="test1" classname="flow1" />
    <testcase name="test2" classname="flow2">
      <failure message="Expected element not found">
        Element with id 'login-button' not found
      </failure>
    </testcase>
    <testcase name="test3" classname="flow3" />
    <testcase name="test4" classname="flow4" />
    <testcase name="test5" classname="flow5" />
  </testsuite>
</testsuites>`;

      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);
      mockReadFileSync.mockImplementation((pathStr: string) => {
        if (pathStr.includes('report.xml')) {
          return junitXml;
        }
        return '{}';
      });

      const result = await runTests(makeConfig(), {
        platform: 'mobile',
        suite: 'smoke',
        noEnsure: true
      });

      expect(result.tests.total).toBe(5);
      expect(result.tests.passed).toBe(4);
      expect(result.tests.failed).toBe(1);
      expect(result.tests.skipped).toBe(0);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].test).toBe('test2');
      expect(result.failures[0].message).toContain('Expected element not found');
    });

    it('parses JSON for playwright test results', async () => {
      const playwrightJson = {
        suites: [{
          specs: [
            { title: 'test1', ok: true },
            { title: 'test2', ok: false, tests: [{ results: [{ error: { message: 'Assertion failed' } }] }] },
            { title: 'test3', ok: true },
          ]
        }]
      };

      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('results.json')) {
          return JSON.stringify(playwrightJson);
        }
        return '{}';
      });

      const result = await runTests(makeConfig(), {
        platform: 'webapp',
        noEnsure: true
      });

      expect(result.tests.total).toBe(3);
      expect(result.tests.passed).toBe(2);
      expect(result.tests.failed).toBe(1);
    });

    it('parses JSON for vitest test results', async () => {
      const vitestJson = {
        numTotalTests: 10,
        numPassedTests: 8,
        numFailedTests: 2,
        numPendingTests: 0,
        testResults: [
          {
            name: 'test1.test.ts',
            assertionResults: [
              { status: 'passed', title: 'test1' },
              { status: 'failed', title: 'test2', failureMessages: ['Expected 2 to be 3'] },
            ]
          }
        ]
      };

      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);
      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('results.json')) {
          return JSON.stringify(vitestJson);
        }
        return '{}';
      });

      const result = await runTests(makeConfig(), {
        platform: 'api',
        noEnsure: true
      });

      expect(result.tests.total).toBe(10);
      expect(result.tests.passed).toBe(8);
      expect(result.tests.failed).toBe(2);
      expect(result.failures.length).toBeGreaterThan(0);
    });
  });

  describe('exit codes', () => {
    it('returns result: pass when process exits with 0', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(result.run.result).toBe('pass');
    });

    it('returns result: fail when process exits with 1', async () => {
      const mockProcess = createMockProcess(1);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(result.run.result).toBe('fail');
    });

    it('returns result: error when process exits with code > 1', async () => {
      const mockProcess = createMockProcess(2);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(result.run.result).toBe('error');
    });

    it('returns result: timeout when timeout occurs', async () => {
      const mockProcess = createMockProcess(null);
      mockSpawn.mockReturnValue(mockProcess);

      // Manually trigger exit after SIGKILL
      setTimeout(() => {
        mockProcess.emit('exit', null, 'SIGKILL');
      }, 1300);

      const result = await runTests(makeConfig(), {
        platform: 'api',
        noEnsure: true,
        timeout: 100
      });

      expect(result.run.result).toBe('timeout');
    }, 5000);
  });

  describe('jaeger trace fetching', () => {
    it('fetches Jaeger traces when tests fail', async () => {
      const mockProcess = createMockProcess(1);
      mockSpawn.mockReturnValue(mockProcess);

      const vitestJson = {
        numTotalTests: 5,
        numPassedTests: 3,
        numFailedTests: 2,
        numPendingTests: 0,
        testResults: [
          {
            name: 'test1.test.ts',
            assertionResults: [
              { status: 'passed', title: 'test1' },
              { status: 'failed', title: 'test2', failureMessages: ['Error'] },
            ]
          }
        ]
      };

      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('results.json')) {
          return JSON.stringify(vitestJson);
        }
        return '{}';
      });

      const mockTraces = { data: [{ traceID: 'trace-123' }] };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockTraces,
      });

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/traces?service=testapp-api&lookback=5m&tags=')
      );

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('api-traces.json'),
        JSON.stringify(mockTraces, null, 2)
      );

      expect(result.logs.apiTraces).toBeDefined();
      expect(result.logs.apiTraces).toContain('api-traces.json');
    });

    it('does not fail when Jaeger is unavailable', async () => {
      const mockProcess = createMockProcess(1);
      mockSpawn.mockReturnValue(mockProcess);

      const vitestJson = {
        numTotalTests: 5,
        numPassedTests: 3,
        numFailedTests: 2,
        numPendingTests: 0,
        testResults: []
      };

      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('results.json')) {
          return JSON.stringify(vitestJson);
        }
        return '{}';
      });

      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(result.run.result).toBe('fail');
      expect(result.logs.apiTraces).toBeUndefined();
    });

    it('does not fetch traces when tests pass', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      const vitestJson = {
        numTotalTests: 5,
        numPassedTests: 5,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: []
      };

      mockReadFileSync.mockImplementation((p: string) => {
        if (p.includes('results.json')) {
          return JSON.stringify(vitestJson);
        }
        return '{}';
      });

      global.fetch = vi.fn();

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.logs.apiTraces).toBeUndefined();
    });
  });

  describe('auto-ensure', () => {
    it('calls ensureEnvironment when no state exists and noEnsure is not set', async () => {
      mockReadState.mockReturnValue(null);
      mockEnsureEnvironment.mockResolvedValue(defaultState);

      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'mobile', suite: 'smoke' });

      expect(mockEnsureEnvironment).toHaveBeenCalledWith(
        expect.any(Object),
        { frontend: 'mobile' }
      );
    });

    it('calls ensureEnvironment with webapp frontend for webapp platform', async () => {
      mockReadState.mockReturnValue(null);
      mockEnsureEnvironment.mockResolvedValue(defaultState);

      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'webapp' });

      expect(mockEnsureEnvironment).toHaveBeenCalledWith(
        expect.any(Object),
        { frontend: 'webapp' }
      );
    });

    it('skips ensure when noEnsure is true and throws if no state', async () => {
      mockReadState.mockReturnValue(null);

      await expect(
        runTests(makeConfig(), { platform: 'api', noEnsure: true })
      ).rejects.toThrow('No environment state found');

      expect(mockEnsureEnvironment).not.toHaveBeenCalled();
    });

    it('skips ensure when state already exists', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(mockEnsureEnvironment).not.toHaveBeenCalled();
    });
  });

  describe('output paths', () => {
    it('uses .grove/test-output/ for output directory', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      const result = await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      expect(result.logs.stdout).toContain('.grove/test-output/api/stdout.log');
    });

    it('uses config cwd for webapp platform', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'webapp', noEnsure: true });

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2]?.cwd).toContain('src/e2e/webapp');
    });

    it('uses config cwd for api platform', async () => {
      const mockProcess = createMockProcess(0);
      mockSpawn.mockReturnValue(mockProcess);

      await runTests(makeConfig(), { platform: 'api', noEnsure: true });

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2]?.cwd).toContain('src/e2e/api');
    });
  });
});

// Helper to create mock child process
function createMockProcess(
  exitCode: number | null,
  stdout: string = '',
  stderr: string = ''
): ChildProcess {
  const stdoutEmitter = new (require('events').EventEmitter)();
  const stderrEmitter = new (require('events').EventEmitter)();
  const processEmitter = new (require('events').EventEmitter)();

  const mockProcess = Object.assign(processEmitter, {
    stdout: stdoutEmitter,
    stderr: stderrEmitter,
    kill: vi.fn().mockReturnValue(true),
    pid: 12345,
    exitCode: null,
  }) as unknown as ChildProcess;

  // Update exitCode when process exits
  processEmitter.on('exit', (code: number | null) => {
    (mockProcess as any).exitCode = code;
  });

  // Emit data and exit asynchronously
  setTimeout(() => {
    if (stdout) stdoutEmitter.emit('data', Buffer.from(stdout));
    if (stderr) stderrEmitter.emit('data', Buffer.from(stderr));
    if (exitCode !== null) {
      processEmitter.emit('exit', exitCode, null);
    }
  }, 10);

  return mockProcess;
}
