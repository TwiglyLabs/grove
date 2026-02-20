import { writeFileSync } from 'fs';
import { join } from 'path';
import type { RepoId } from '../shared/identity.js';
import { load as loadConfig } from '../shared/config.js';
import { readState } from '../state.js';
import { printError } from '../shared/output.js';

export async function reloadCommand(repoId: RepoId, service?: string): Promise<void> {
  const config = await loadConfig(repoId);
  const targets = config.utilities?.reloadTargets ?? [];

  if (!service) {
    printError('Usage: grove reload <service>');
    console.log(`Valid services: ${targets.join(', ')}`);
    process.exit(1);
  }

  if (!targets.includes(service)) {
    printError(`Unknown service: ${service}`);
    console.log(`Valid services: ${targets.join(', ')}`);
    process.exit(1);
  }

  const state = readState(config);
  if (!state) {
    printError('Dev environment not running. Run `grove up` first.');
    process.exit(1);
  }

  // Signal the running orchestrator by writing to .reload-request
  const reloadPath = join(config.repoRoot, '.reload-request');
  writeFileSync(reloadPath, service + '\n');

  console.log(`Reload requested for ${service}. Watch the grove watch console for progress.`);
}
