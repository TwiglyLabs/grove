import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import { printWarning, printError } from '../output.js';
import { execSync } from 'child_process';

function getStateFilePath(config: GroveConfig): string {
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const worktreeId = branch.replace(/[^a-z0-9-]/gi, '-').toLowerCase().substring(0, 63);
  return join(config.repoRoot, '.grove', `${worktreeId}.json`);
}

export async function logsCommand(config: GroveConfig, serviceName: string): Promise<void> {
  const stateFile = getStateFilePath(config);

  if (!existsSync(stateFile)) {
    printWarning('No state file found - environment is not running');
    return;
  }

  // Check if it's a port-forward or frontend log
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
