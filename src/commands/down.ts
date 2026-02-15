import type { GroveConfig } from '../config.js';
import { readState } from '../state.js';
import { printInfo, printSuccess, printWarning } from '../output.js';

export async function downCommand(config: GroveConfig): Promise<void> {
  const state = readState(config);

  if (!state) {
    printWarning('No state file found - environment may not be running');
    return;
  }

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
