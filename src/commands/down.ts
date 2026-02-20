import type { RepoId } from '../shared/identity.js';
import { down } from '../api/environment.js';
import { printInfo, printSuccess, printWarning } from '../shared/output.js';

export async function downCommand(repoId: RepoId): Promise<void> {
  printInfo('Stopping processes...');

  const result = await down(repoId);

  if (result.stopped.length === 0 && result.notRunning.length === 0) {
    printWarning('No state file found - environment may not be running');
    return;
  }

  for (const entry of result.stopped) {
    if (entry.success) {
      printSuccess(`Stopped ${entry.name} (PID: ${entry.pid})`);
    } else {
      printWarning(`Failed to stop ${entry.name} (PID: ${entry.pid})`);
    }
  }

  for (const name of result.notRunning) {
    printWarning(`${name} - already stopped`);
  }

  printSuccess('All processes stopped');
}
