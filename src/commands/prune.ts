import type { RepoId } from '../api/identity.js';
import { prune } from '../api/environment.js';
import { printInfo, printSuccess, printWarning } from '../output.js';

export async function pruneCommand(repoId: RepoId): Promise<void> {
  printInfo('Checking for orphaned resources...');

  const result = await prune(repoId);

  for (const ns of result.deleted) {
    printSuccess(`Deleted orphaned namespace: ${ns}`);
  }

  if (result.deleted.length === 0) {
    printSuccess('No orphaned resources found');
  } else {
    printSuccess(`Cleaned up ${result.deleted.length} orphaned namespace(s)`);
  }
}
