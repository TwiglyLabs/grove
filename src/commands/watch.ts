import type { RepoId } from '../shared/identity.js';
import { watch } from '../api/environment.js';
import { EnvironmentNotRunningError } from '../shared/errors.js';
import { printInfo, printWarning } from '../shared/output.js';

export async function watchCommand(repoId: RepoId): Promise<void> {
  let handle;
  try {
    handle = await watch(repoId);
  } catch (error) {
    if (error instanceof EnvironmentNotRunningError) {
      printWarning('No state file found - run "grove up" first');
      return;
    }
    throw error;
  }

  printInfo('Press Ctrl+C to stop watching');

  // Keep process alive
  process.on('SIGINT', () => {
    handle.stop();
    process.exit(0);
  });
}
