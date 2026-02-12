import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import { readState } from '../state.js';
import { printWarning, printError } from '../output.js';

export async function logsCommand(config: GroveConfig, serviceName: string, args: string[] = []): Promise<void> {
  const isPod = args.includes('--pod');

  const state = readState(config);
  if (!state) {
    printWarning('No state file found - environment is not running');
    return;
  }

  if (isPod) {
    // kubectl logs mode
    console.log(`Tailing logs for ${serviceName} in ${state.namespace}...`);
    console.log('(Ctrl+C to stop)');
    console.log('');

    const proc = spawn(
      'kubectl',
      ['logs', '-n', state.namespace, '-l', `app=${serviceName}`, '-f', '--tail=100'],
      { stdio: 'inherit' }
    );

    proc.on('error', (err) => {
      printError(`Failed to start kubectl: ${err.message}`);
      process.exit(1);
    });

    proc.on('exit', (code) => {
      process.exit(code ?? 0);
    });

    // Keep running until killed
    await new Promise(() => {});
    return;
  }

  // File-based logs (default)
  const logsDir = join(config.repoRoot, '.grove', 'logs');
  const portForwardLog = join(logsDir, `port-forward-${serviceName}.log`);
  const frontendLog = join(logsDir, `${serviceName}.log`);

  let logFile: string | null = null;

  if (existsSync(portForwardLog)) {
    logFile = portForwardLog;
  } else if (existsSync(frontendLog)) {
    logFile = frontendLog;
  }

  if (!logFile) {
    printError(`No logs found for service: ${serviceName}`);
    return;
  }

  const content = readFileSync(logFile, 'utf-8');
  console.log(content);
}
