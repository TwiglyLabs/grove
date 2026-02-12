import chalk from 'chalk';
import type { NamespaceInfo, FailureDetail, TestResult } from './types.js';

export function printBanner(projectName: string): void {
  console.log();
  console.log(chalk.cyan.bold(`╔═══════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  Grove - ${projectName.padEnd(27)} ║`));
  console.log(chalk.cyan.bold(`╔═══════════════════════════════════════╗`));
  console.log();
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

export function printSection(title: string): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();
}

export function printKeyValue(key: string, value: string, indent: number = 0): void {
  const spaces = ' '.repeat(indent);
  console.log(`${spaces}${chalk.dim(key + ':')} ${value}`);
}

export function printUrlTable(urls: Record<string, string>): void {
  console.log();
  console.log(chalk.bold('Service URLs:'));
  console.log();

  const maxKeyLength = Math.max(...Object.keys(urls).map(k => k.length));

  for (const [service, url] of Object.entries(urls)) {
    const paddedService = service.padEnd(maxKeyLength);
    console.log(`  ${chalk.cyan(paddedService)}  ${chalk.blue.underline(url)}`);
  }

  console.log();
}

/**
 * Print a progress step with status icon.
 */
export function printProgress(
  step: string,
  status: 'pending' | 'done' | 'error'
): void {
  const icon =
    status === 'done'
      ? chalk.green('✓')
      : status === 'error'
        ? chalk.red('✗')
        : chalk.yellow('○');
  console.log(`  ${icon} ${step}`);
}

/**
 * Format a date as a human-readable age.
 */
export function formatAge(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  return `${diffMinutes}m`;
}

/**
 * Print namespace status table.
 */
export function printNamespaceStatus(namespaces: NamespaceInfo[]): void {
  console.log('');
  console.log(
    chalk.bold('NAMESPACE                  BRANCH              AGE    PORT-FORWARDS')
  );
  console.log('');

  for (const ns of namespaces) {
    const age = formatAge(ns.createdAt);
    const portStatus = ns.hasActivePortForwards
      ? chalk.green('✓ active')
      : chalk.dim('✗ inactive');

    console.log(
      `${ns.name.padEnd(26)} ${ns.branch.padEnd(19)} ${age.padEnd(6)} ${portStatus}`
    );
  }

  console.log('');
}

/**
 * Print prune results.
 */
export function printPruneResult(deleted: string[], kept: string[]): void {
  console.log('');
  console.log(chalk.bold('Pruning namespaces...'));
  console.log(chalk.dim('  E2E namespaces: > 1 hour old'));
  console.log(chalk.dim('  Dev namespaces: > 7 days old'));
  console.log('');

  for (const ns of deleted) {
    console.log(`  ${chalk.green('✓')} Deleted ${ns}`);
  }

  if (deleted.length === 0) {
    console.log(chalk.dim('  No namespaces to prune'));
  }

  console.log('');
  if (kept.length > 0) {
    console.log(`Kept ${kept.length} namespace(s)`);
  }
}

export interface DashboardData {
  state: 'healthy' | 'degraded' | 'error';
  namespace: string;
  branch: string;
  worktreeId: string;
  lastEnsure: string;
  health: {
    namespace: string;
    healthy: boolean;
    pods: Array<{ app: string; ready: boolean; phase: string }>;
  };
  portForwards: Array<{ port: number; service: string; healthy: boolean }>;
  processes: Array<{ name: string; pid: number; startedAt: string; running: boolean }>;
  urls?: Record<string, string>;
  ports?: Record<string, number>;
  startupHistory?: Array<{ timestamp: string; type: string; duration: number }>;
}

/**
 * Print a human-readable health dashboard.
 */
export function printDashboard(data: DashboardData): void {
  const stateColor = data.state === 'healthy'
    ? chalk.green
    : data.state === 'degraded'
      ? chalk.yellow
      : chalk.red;

  console.log('');
  console.log(chalk.bold('Environment Status'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  State:       ${stateColor(data.state.toUpperCase())}`);
  console.log(`  Namespace:   ${chalk.cyan(data.namespace)}`);
  console.log(`  Branch:      ${data.branch}`);
  console.log(`  Worktree:    ${data.worktreeId}`);
  console.log(`  Last ensure: ${formatAge(new Date(data.lastEnsure))} ago`);
  console.log('');

  // Services (pods)
  console.log(chalk.bold('Services'));
  console.log(chalk.dim('─'.repeat(50)));
  if (data.health.pods.length === 0) {
    console.log(chalk.dim('  No pods found'));
  } else {
    for (const pod of data.health.pods) {
      const icon = pod.ready && pod.phase === 'Running'
        ? chalk.green('●')
        : chalk.red('●');
      console.log(`  ${icon} ${pod.app.padEnd(20)} ${pod.phase}`);
    }
  }
  console.log('');

  // Port forwards
  console.log(chalk.bold('Port Forwards'));
  console.log(chalk.dim('─'.repeat(50)));
  for (const pf of data.portForwards) {
    const icon = pf.healthy ? chalk.green('●') : chalk.red('●');
    console.log(`  ${icon} ${pf.service.padEnd(20)} :${pf.port}`);
  }
  console.log('');

  // Processes
  if (data.processes.length > 0) {
    console.log(chalk.bold('Processes'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const proc of data.processes) {
      const icon = proc.running ? chalk.green('●') : chalk.red('●');
      const uptime = proc.running ? formatAge(new Date(proc.startedAt)) : 'stopped';
      console.log(`  ${icon} ${proc.name.padEnd(20)} pid:${proc.pid}  uptime:${uptime}`);
    }
    console.log('');
  }

  // URLs
  if (data.urls && Object.keys(data.urls).length > 0) {
    console.log(chalk.bold('URLs'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const [name, url] of Object.entries(data.urls)) {
      console.log(`  ${name.padEnd(20)} ${chalk.underline(url)}`);
    }
    console.log('');
  }

  // Startup history
  if (data.startupHistory && data.startupHistory.length > 0) {
    console.log(chalk.bold('Recent Startups'));
    console.log(chalk.dim('─'.repeat(50)));
    for (const entry of data.startupHistory) {
      const typeColor = entry.type === 'warm'
        ? chalk.green
        : entry.type === 'recovery'
          ? chalk.yellow
          : chalk.cyan;
      const durationStr = entry.duration < 5000
        ? chalk.green(`${(entry.duration / 1000).toFixed(1)}s`)
        : entry.duration < 30000
          ? chalk.yellow(`${(entry.duration / 1000).toFixed(1)}s`)
          : chalk.red(`${(entry.duration / 1000).toFixed(1)}s`);
      const time = new Date(entry.timestamp).toLocaleTimeString();
      console.log(`  ${typeColor(entry.type.padEnd(10))} ${durationStr.padStart(8)}  ${chalk.dim(time)}`);
    }
    console.log('');
  }
}

/**
 * Print test result summary.
 */
export function printTestResult(result: TestResult): void {
  const icon = result.run.result === 'pass'
    ? chalk.green('✓')
    : result.run.result === 'fail'
      ? chalk.red('✗')
      : result.run.result === 'timeout'
        ? chalk.yellow('⏱')
        : chalk.red('!');

  console.log('');
  console.log(chalk.bold('Test Results'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(`  ${icon} ${result.run.platform}/${result.run.suite} — ${result.run.result.toUpperCase()}`);
  console.log(`  Duration: ${result.run.duration}`);
  console.log(`  Passed: ${chalk.green(String(result.tests.passed))}  Failed: ${chalk.red(String(result.tests.failed))}  Skipped: ${chalk.dim(String(result.tests.skipped))}  Total: ${result.tests.total}`);
  console.log('');
}

/**
 * Print detailed test failure output.
 */
export function printTestFailures(failures: FailureDetail[]): void {
  if (failures.length === 0) return;

  console.log(chalk.bold.red('Failures'));
  console.log(chalk.dim('─'.repeat(50)));

  for (const failure of failures) {
    console.log(`  ${chalk.red('✗')} ${failure.test}`);
    if (failure.file) {
      const loc = failure.line ? `${failure.file}:${failure.line}` : failure.file;
      console.log(`    ${chalk.dim(loc)}`);
    }
    console.log(`    ${failure.message}`);
    console.log('');
  }
}
