import { execSync } from 'child_process';
import type { GroveConfig } from '../config.js';
import { readState, releasePortBlock } from '../state.js';
import { printInfo, printSuccess, printWarning } from '../output.js';
import { downCommand } from './down.js';

export async function destroyCommand(config: GroveConfig): Promise<void> {
  // First stop all processes
  await downCommand(config);

  const state = readState(config);

  if (!state) {
    printWarning('No state file found');
    return;
  }

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
    releasePortBlock(config, state.worktreeId);
    printSuccess('State file removed');
  } catch (error) {
    printWarning('Failed to remove state file');
  }

  printSuccess('Environment destroyed');
}
