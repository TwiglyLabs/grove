import type { GroveConfig } from '../config.js';
import { readState } from '../state.js';
import { FileWatcher } from '../watcher.js';
import { printInfo, printWarning } from '../output.js';

export async function watchCommand(config: GroveConfig): Promise<void> {
  const state = readState(config);

  if (!state) {
    printWarning('No state file found - run "grove up" first');
    return;
  }

  const watcher = new FileWatcher(config, state);
  watcher.start();

  printInfo('Press Ctrl+C to stop watching');

  // Keep process alive
  process.on('SIGINT', () => {
    watcher.stop();
    process.exit(0);
  });
}
