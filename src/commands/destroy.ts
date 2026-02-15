import type { RepoId } from '../api/identity.js';
import { destroy } from '../api/environment.js';
import { printInfo, printSuccess, printWarning } from '../output.js';

export async function destroyCommand(repoId: RepoId): Promise<void> {
  const result = await destroy(repoId);

  // Report process stoppage
  for (const entry of result.stopped.stopped) {
    if (entry.success) {
      printSuccess(`Stopped ${entry.name} (PID: ${entry.pid})`);
    } else {
      printWarning(`Failed to stop ${entry.name} (PID: ${entry.pid})`);
    }
  }

  // Report namespace deletion
  if (result.namespaceDeleted) {
    printSuccess('Namespace deleted');
  } else {
    printWarning('Failed to delete namespace - it may not exist');
  }

  // Report state removal
  if (result.stateRemoved) {
    printSuccess('State file removed');
  } else {
    printWarning('Failed to remove state file');
  }

  printSuccess('Environment destroyed');
}
