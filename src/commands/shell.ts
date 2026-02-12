import { spawn, execSync } from 'child_process';
import type { GroveConfig } from '../config.js';
import { readState } from '../state.js';
import { printError } from '../output.js';

export async function shellCommand(config: GroveConfig, service?: string): Promise<void> {
  const targets = config.utilities?.shellTargets ?? [];

  if (!service) {
    printError('Usage: grove shell <service>');
    console.log('');
    console.log('Available services:');
    targets.forEach((t) => console.log(`  - ${t.name}`));
    process.exit(1);
  }

  const target = targets.find(t => t.name === service);
  if (!target) {
    printError(`Unknown service: ${service}`);
    console.log('');
    console.log('Available services:');
    targets.forEach((t) => console.log(`  - ${t.name}`));
    process.exit(1);
  }

  const state = readState(config);
  if (!state) {
    printError('Dev environment not running. Run `grove up` first.');
    process.exit(1);
  }

  const podSelector = target.podSelector ?? `app=${service}`;
  const shell = target.shell ?? '/bin/sh';

  // Get the first pod for this service
  const podName = execSync(
    `kubectl get pods -n ${state.namespace} -l ${podSelector} -o jsonpath='{.items[0].metadata.name}'`,
    { encoding: 'utf-8' }
  )
    .trim()
    .replace(/'/g, '');

  if (!podName) {
    printError(`No running pod found for ${service}`);
    process.exit(1);
  }

  console.log(`Opening shell in ${podName}...`);
  console.log('(Type "exit" to close)');
  console.log('');

  const proc = spawn(
    'kubectl',
    ['exec', '-n', state.namespace, '-it', podName, '--', shell],
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
}
