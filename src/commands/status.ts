import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../state.js';
import { printSection, printKeyValue, printWarning, printUrlTable } from '../output.js';
import { sanitizeBranchName } from '../sanitize.js';
import { execSync } from 'child_process';

function getStateFilePath(config: GroveConfig): string {
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const worktreeId = sanitizeBranchName(branch);
  return join(config.repoRoot, '.grove', `${worktreeId}.json`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function statusCommand(config: GroveConfig): Promise<void> {
  const stateFile = getStateFilePath(config);

  if (!existsSync(stateFile)) {
    printWarning('No state file found - environment is not running');
    return;
  }

  const stateContent = readFileSync(stateFile, 'utf-8');
  const state: EnvironmentState = JSON.parse(stateContent);

  printSection('Environment Status');

  printKeyValue('Project', config.project.name);
  printKeyValue('Namespace', state.namespace);
  printKeyValue('Branch', state.branch);
  printKeyValue('Worktree ID', state.worktreeId);
  printKeyValue('Last Ensure', new Date(state.lastEnsure).toLocaleString());

  printSection('Processes');

  for (const [name, processInfo] of Object.entries(state.processes)) {
    const running = isProcessRunning(processInfo.pid);
    const status = running ? 'Running' : 'Stopped';
    printKeyValue(name, `PID ${processInfo.pid} - ${status}`, 2);
  }

  printUrlTable(state.urls);
}
