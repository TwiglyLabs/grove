import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../environment/types.js';
import { readState } from '../environment/state.js';
import { ensureEnvironment } from '../environment/controller.js';
import { sanitizeBranchName } from '../workspace/sanitize.js';
import { resolveTemplates } from '../environment/template.js';
import { parseJunitXml, parsePlaywrightJson, parseVitestJson } from './result-parsers.js';
import { archiveResults } from './result-archive.js';
import type { TestOptions, TestResult, FailureDetail } from './types.js';

// --- Suite Mapping ---

function resolveSuitePaths(config: GroveConfig, suite?: string, flow?: string[]): string[] {
  if (!config.testing?.mobile) return [];

  const maestroBase = path.join(config.repoRoot, config.testing.mobile.basePath);

  if (flow && flow.length > 0) {
    return flow.map(f => path.join(maestroBase, f));
  }

  // Check named suites from config
  if (suite && config.testing.mobile.suites) {
    const namedSuite = config.testing.mobile.suites.find(s => s.name === suite);
    if (namedSuite) {
      return namedSuite.paths.map(p => path.join(maestroBase, p));
    }
  }

  // Fallback: try suite as a direct path under basePath
  if (suite) {
    // Check for file named <suite>.yaml or directory named <suite>
    const yamlPath = path.join(maestroBase, `flows/${suite}.yaml`);
    // Use the suite name as-is; maestro will resolve it
    return [yamlPath];
  }

  // Default: all flows
  return [path.join(maestroBase, 'flows')];
}

// --- Maestro Cleanup ---

function cleanupBeforeMaestro(config: GroveConfig, state: EnvironmentState): void {
  const udid = state.simulator?.udid;
  const bundleId = config.simulator?.bundleId;

  if (udid && bundleId) {
    // Terminate the app if running (prevents XCUITest quiescence timeout)
    try {
      execSync(`xcrun simctl terminate ${udid} ${bundleId}`, { stdio: 'ignore' });
    } catch {
      // App not running - expected
    }

    // Set RCT_jsLocation in NSGlobalDomain so the app finds Metro after clearState
    const metroFrontend = config.simulator?.metroFrontend;
    const metroUrl = metroFrontend ? state.urls[metroFrontend] : undefined;
    if (metroUrl) {
      try {
        const parsed = new URL(metroUrl);
        const jsLocation = `${parsed.hostname}:${parsed.port}`;
        execSync(
          `xcrun simctl spawn ${udid} defaults write NSGlobalDomain RCT_jsLocation "${jsLocation}"`,
          { stdio: 'ignore' },
        );
      } catch {
        // Non-fatal: app will fall back to localhost:8081
      }
    }
  }

  // Kill orphaned xcodebuild XCTest runner processes
  try {
    execSync('pkill -f "xcodebuild.*test-without-building.*maestro"', { stdio: 'ignore' });
  } catch {
    // No matching processes - expected
  }

  // Kill any lingering Maestro Java processes
  try {
    execSync('pkill -f "maestro.cli"', { stdio: 'ignore' });
  } catch {
    // No matching processes
  }
}

// --- Maestro Command ---

function getSimulatorUdid(config: GroveConfig, state: EnvironmentState): string {
  // Try state first
  if (state.simulator?.udid) {
    return state.simulator.udid;
  }

  // Fall back to detecting simulator
  const simListOutput = execSync('xcrun simctl list devices --json', { encoding: 'utf-8' });
  const simList = JSON.parse(simListOutput);

  const prefix = config.simulator?.simulatorPrefix ?? config.project.name;
  const branch = state.branch;
  const expectedName = `${prefix}-${sanitizeBranchName(branch)}`;

  for (const devices of Object.values(simList.devices) as any[]) {
    for (const device of devices) {
      if (device.name === expectedName && device.state === 'Booted') {
        return device.udid;
      }
    }
  }

  throw new Error(`Simulator ${expectedName} not found or not booted`);
}

function buildMaestroCommand(
  config: GroveConfig,
  flowPaths: string[],
  outputDir: string,
  state: EnvironmentState
): { command: string; args: string[] } {
  const udid = getSimulatorUdid(config, state);

  const reportFile = `${outputDir}/report.xml`;

  // Resolve env vars from config
  const envVars = config.testing?.mobile?.envVars
    ? resolveTemplates(config.testing.mobile.envVars, state)
    : {};

  const envArgs: string[] = [];
  for (const [key, value] of Object.entries(envVars)) {
    envArgs.push('-e', `${key}=${value}`);
  }

  const args = [
    'test',
    '--device', udid,
    '--output', reportFile,
    '--format', 'junit',
    '--debug-output', outputDir,
    ...envArgs,
    ...flowPaths,
  ];

  return { command: 'maestro', args };
}

// --- Playwright Command ---

function buildPlaywrightCommand(
  outputDir: string,
  file?: string,
  grep?: string
): { command: string; args: string[] } {
  const args = [
    'playwright',
    'test',
    '--reporter=json',
    `--output=${outputDir}`,
  ];

  if (file) {
    args.push(file);
  }

  if (grep) {
    args.push(`--grep=${grep}`);
  }

  return { command: 'npx', args };
}

// --- Vitest Command ---

function buildVitestCommand(
  outputDir: string,
  options: TestOptions,
  state: EnvironmentState | null
): { command: string; args: string[]; env: Record<string, string> } {
  const args = [
    'vitest',
    'run',
    '--reporter=json',
    `--outputFile=${path.join(outputDir, 'results.json')}`,
  ];

  if (options.useDev) {
    args.push('--globalSetup=');
  }

  if (options.file) {
    args.push(options.file);
  }

  if (options.grep) {
    args.push('-t', options.grep);
  }

  const env: Record<string, string> = {};

  // Copy process.env, filtering out undefined values
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (options.ai) {
    env.INCLUDE_AI_TESTS = 'true';
  }

  if (options.excludeAi) {
    env.EXCLUDE_AI_TESTS = 'true';
  }

  if (options.useDev && state) {
    env.API_URL = state.urls.api;
  }

  return { command: 'npx', args, env };
}

// --- Process Execution ---

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function runProcess(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeout: number
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, { cwd, env });

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      // Give it grace period to gracefully exit (10% of timeout or min 1s)
      const gracePeriod = Math.max(1000, timeout * 0.1);
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, gracePeriod);
    }, timeout);

    child.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

// --- Main Function ---

export async function runTests(config: GroveConfig, options: TestOptions): Promise<TestResult> {
  let state = readState(config);
  const timeout = options.timeout || config.testing?.defaultTimeout || 300000;

  // Read existing state or auto-ensure
  if (!state && !options.noEnsure) {
    console.log(`[test] No environment found. Running grove up for ${options.platform}...`);
    const ensureResult = await ensureEnvironment(config, {
      frontend: options.platform === 'mobile' ? 'mobile' :
                options.platform === 'webapp' ? 'webapp' : undefined,
    });
    state = ensureResult.state ?? (ensureResult as unknown as EnvironmentState);
    console.log(`[test] Environment ready`);
  }

  if (!state) {
    throw new Error('No environment state found. Run grove up first, or remove --no-ensure.');
  }

  const suite = options.suite || 'default';
  const runId = `${options.platform}-${suite}-${Date.now()}`;

  // Set up output directory
  const outputBaseDir = path.join(config.repoRoot, '.grove/test-output');
  let outputDir: string;
  let cwd: string;

  if (options.platform === 'mobile') {
    outputDir = path.join(outputBaseDir, 'maestro');
    cwd = config.repoRoot;
  } else if (options.platform === 'webapp') {
    outputDir = path.join(outputBaseDir, 'playwright');
    cwd = path.join(config.repoRoot, config.testing?.webapp?.cwd ?? 'src/e2e/webapp');
  } else {
    outputDir = path.join(outputBaseDir, 'api');
    cwd = path.join(config.repoRoot, config.testing?.api?.cwd ?? 'src/e2e/api');
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Build command
  let command: string;
  let args: string[];
  let env: Record<string, string> = {};

  // Copy process.env, filtering out undefined values
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (options.platform === 'mobile') {
    cleanupBeforeMaestro(config, state);
    const flowPaths = resolveSuitePaths(config, options.suite, options.flow);
    ({ command, args } = buildMaestroCommand(config, flowPaths, outputDir, state));
  } else if (options.platform === 'webapp') {
    ({ command, args } = buildPlaywrightCommand(outputDir, options.file, options.grep));
  } else {
    ({ command, args, env } = buildVitestCommand(outputDir, options, state));
  }

  // Run tests
  const startTime = Date.now();
  const result = await runProcess(command, args, cwd, env, timeout);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2) + 's';

  // Write logs
  const stdoutLog = path.join(outputDir, 'stdout.log');
  const stderrLog = path.join(outputDir, 'stderr.log');
  fs.writeFileSync(stdoutLog, result.stdout);
  fs.writeFileSync(stderrLog, result.stderr);

  // Parse results
  let testStats: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    failures: FailureDetail[];
  };

  if (options.platform === 'mobile') {
    const junitPath = path.join(outputDir, 'report.xml');
    let junitContent = '';
    try {
      junitContent = fs.readFileSync(junitPath, 'utf-8');
    } catch {
      // JUnit file might not exist if tests errored early
    }
    testStats = parseJunitXml(junitContent);
  } else if (options.platform === 'webapp') {
    const resultsPath = path.join(outputDir, 'results.json');
    let resultsContent = '{}';
    try {
      resultsContent = fs.readFileSync(resultsPath, 'utf-8');
    } catch {
      // Results file might not exist
    }
    testStats = parsePlaywrightJson(resultsContent);
  } else {
    const resultsPath = path.join(outputDir, 'results.json');
    let resultsContent = '{}';
    try {
      resultsContent = fs.readFileSync(resultsPath, 'utf-8');
    } catch {
      // Results file might not exist
    }
    testStats = parseVitestJson(resultsContent);
  }

  // Fetch Jaeger traces on failure
  let apiTracesPath: string | undefined;
  const serviceName = config.testing?.observability?.serviceName;
  const jaegerPort = state.ports.jaeger;
  if (testStats.failed > 0 && jaegerPort && serviceName) {
    try {
      const jaegerUrl = `http://localhost:${jaegerPort}`;
      const tracesResponse = await fetch(
        `${jaegerUrl}/api/traces?service=${serviceName}&lookback=5m&tags=${encodeURIComponent('{"error":"true"}')}&limit=20`
      );
      if (tracesResponse.ok) {
        const traces = await tracesResponse.json();
        const logsDir = path.join(config.repoRoot, '.grove/logs');
        fs.mkdirSync(logsDir, { recursive: true });
        apiTracesPath = path.join(logsDir, 'api-traces.json');
        fs.writeFileSync(apiTracesPath, JSON.stringify(traces, null, 2));
      }
    } catch {
      // Jaeger might not be available
    }
  }

  // Archive results
  archiveResults(options.platform, suite, outputDir, config);

  // Determine result status
  let resultStatus: 'pass' | 'fail' | 'error' | 'timeout';
  if (result.timedOut) {
    resultStatus = 'timeout';
  } else if (result.exitCode === 0) {
    resultStatus = 'pass';
  } else if (result.exitCode === 1) {
    resultStatus = 'fail';
  } else {
    resultStatus = 'error';
  }

  return {
    run: {
      id: runId,
      platform: options.platform,
      suite,
      duration,
      result: resultStatus,
    },
    environment: {
      worktree: state.worktreeId,
      namespace: state.namespace,
    },
    tests: {
      passed: testStats.passed,
      failed: testStats.failed,
      skipped: testStats.skipped,
      total: testStats.total,
    },
    failures: testStats.failures,
    artifacts: {
      screenshots: outputDir,
      videos: outputDir,
      reports: outputDir,
    },
    logs: {
      stdout: stdoutLog,
      stderr: stderrLog,
      junit: options.platform === 'mobile' ? path.join(outputDir, 'report.xml') : undefined,
      apiTraces: apiTracesPath,
    },
  };
}
