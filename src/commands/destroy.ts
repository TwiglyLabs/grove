import { execSync } from 'child_process';
import { readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../state.js';
import { printInfo, printSuccess, printWarning } from '../output.js';
import { downCommand } from './down.js';

function getStateFilePath(config: GroveConfig): string {
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const worktreeId = branch.replace(/[^a-z0-9-]/gi, '-').toLowerCase().substring(0, 63);
  return join(config.repoRoot, '.grove', `${worktreeId}.json`);
}

export async function destroyCommand(config: GroveConfig): Promise<void> {
  const stateFile = getStateFilePath(config);

  // First stop all processes
  await downCommand(config);

  if (!existsSync(stateFile)) {
    printWarning('No state file found');
    return;
  }

  const stateContent = readFileSync(stateFile, 'utf-8');
  const state: EnvironmentState = JSON.parse(stateContent);

  // Delete namespace
  printInfo(`Deleting namespace ${state.namespace}...`);
  try {
    execSync(`kubectl delete namespace ${state.namespace}`, { stdio: 'inherit' });
    printSuccess('Namespace deleted');
  } catch (error) {
    printWarning('Failed to delete namespace - it may not exist');
  }

  // Delete state file
  printInfo('Removing state file...');
  try {
    unlinkSync(stateFile);
    printSuccess('State file removed');
  } catch (error) {
    printWarning('Failed to remove state file');
  }

  printSuccess('Environment destroyed');
}
