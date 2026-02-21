/**
 * Logs slice — CLI subcommand.
 *
 * grove logs <service> [--pod]
 */

import { spawn } from 'child_process';
import type { RepoId } from '../shared/identity.js';
import { readLogs } from './api.js';
import { load as loadConfig } from '../shared/config.js';
import { readState } from '../environment/state.js';
import { printWarning, printError } from '../shared/output.js';

export async function logsCommand(repoId: RepoId, serviceName: string, args: string[] = []): Promise<void> {
  const isPod = args.includes('--pod');

  if (isPod) {
    // kubectl logs mode — need namespace from state
    const config = await loadConfig(repoId);
    const state = readState(config);
    if (!state) {
      printWarning('No state file found - environment is not running');
      return;
    }

    console.log(`Tailing logs for ${serviceName} in ${state.namespace}...`);
    console.log('(Ctrl+C to stop)');
    console.log('');

    const proc = spawn(
      'kubectl',
      ['logs', '-n', state.namespace, '-l', `app=${serviceName}`, '-f', '--tail=100'],
      { stdio: 'inherit' }
    );

    proc.on('error', (err) => {
      printError(`Failed to start kubectl: ${err.message}`);
      process.exit(1);
    });

    proc.on('exit', (code) => {
      process.exit(code ?? 0);
    });

    // Keep running until killed
    await new Promise(() => {});
    return;
  }

  // File-based logs (default)
  const entry = await readLogs(repoId, serviceName);

  if (!entry) {
    printError(`No logs found for service: ${serviceName}`);
    return;
  }

  console.log(entry.content);
}
