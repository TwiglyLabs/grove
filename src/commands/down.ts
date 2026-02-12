import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../state.js';
import { PortForwardProcess } from '../processes/PortForwardProcess.js';
import { GenericDevServer } from '../frontends/GenericDevServer.js';
import { printInfo, printSuccess, printWarning } from '../output.js';

function getStateFilePath(config: GroveConfig): string {
  const { execSync } = require('child_process');
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const worktreeId = branch.replace(/[^a-z0-9-]/gi, '-').toLowerCase().substring(0, 63);
  return join(config.repoRoot, '.grove', `${worktreeId}.json`);
}

export async function downCommand(config: GroveConfig): Promise<void> {
  const stateFile = getStateFilePath(config);

  if (!existsSync(stateFile)) {
    printWarning('No state file found - environment may not be running');
    return;
  }

  const stateContent = readFileSync(stateFile, 'utf-8');
  const state: EnvironmentState = JSON.parse(stateContent);

  printInfo('Stopping processes...');

  // Stop all processes
  for (const [name, processInfo] of Object.entries(state.processes)) {
    try {
      process.kill(processInfo.pid, 'SIGTERM');
      printSuccess(`Stopped ${name} (PID: ${processInfo.pid})`);
    } catch (error) {
      printWarning(`Failed to stop ${name} (PID: ${processInfo.pid}) - may already be stopped`);
    }
  }

  printSuccess('All processes stopped');
}
