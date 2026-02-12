import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from '../state.js';
import { FileWatcher } from '../watcher.js';
import { printInfo, printWarning } from '../output.js';
import { execSync } from 'child_process';

function getStateFilePath(config: GroveConfig): string {
  const branch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
  const worktreeId = branch.replace(/[^a-z0-9-]/gi, '-').toLowerCase().substring(0, 63);
  return join(config.repoRoot, '.grove', `${worktreeId}.json`);
}

export async function watchCommand(config: GroveConfig): Promise<void> {
  const stateFile = getStateFilePath(config);

  if (!existsSync(stateFile)) {
    printWarning('No state file found - run "grove up" first');
    return;
  }

  const stateContent = readFileSync(stateFile, 'utf-8');
  const state: EnvironmentState = JSON.parse(stateContent);

  const watcher = new FileWatcher(config, state);
  watcher.start();

  printInfo('Press Ctrl+C to stop watching');

  // Keep process alive
  process.on('SIGINT', () => {
    watcher.stop();
    process.exit(0);
  });
}
