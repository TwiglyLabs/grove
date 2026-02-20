import { spawn } from 'child_process';
import type { RepoId } from '../shared/identity.js';
import { getShellCommand } from '../api/shell.js';
import { load as loadConfig } from '../shared/config.js';
import { EnvironmentNotRunningError, PodNotFoundError } from '../shared/errors.js';
import { printError } from '../shared/output.js';

export async function shellCommand(repoId: RepoId, service?: string): Promise<void> {
  if (!service) {
    // Show available targets from config
    const config = await loadConfig(repoId);
    const targets = config.utilities?.shellTargets ?? [];
    printError('Usage: grove shell <service>');
    console.log('');
    console.log('Available services:');
    targets.forEach((t) => console.log(`  - ${t.name}`));
    process.exit(1);
  }

  let cmd;
  try {
    cmd = await getShellCommand(repoId, service);
  } catch (error) {
    if (error instanceof EnvironmentNotRunningError) {
      printError('Dev environment not running. Run `grove up` first.');
      process.exit(1);
    }
    if (error instanceof PodNotFoundError) {
      printError(`No running pod found for ${service}`);
      process.exit(1);
    }
    if (error instanceof Error && error.message.includes('Unknown shell target')) {
      const config = await loadConfig(repoId);
      const targets = config.utilities?.shellTargets ?? [];
      printError(`Unknown service: ${service}`);
      console.log('');
      console.log('Available services:');
      targets.forEach((t) => console.log(`  - ${t.name}`));
      process.exit(1);
    }
    throw error;
  }

  console.log(`Opening shell in ${cmd.args[cmd.args.indexOf('-it') + 1]}...`);
  console.log('(Type "exit" to close)');
  console.log('');

  const proc = spawn(cmd.command, cmd.args, { stdio: 'inherit' });

  proc.on('error', (err) => {
    printError(`Failed to start kubectl: ${err.message}`);
    process.exit(1);
  });

  proc.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Keep running until killed
  await new Promise(() => {});
}
