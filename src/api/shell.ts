/**
 * Grove API: Shell module
 *
 * Returns kubectl exec command parts for the consumer to spawn.
 * The Electron app opens its own terminal emulator (xterm.js) with these parts.
 */

import { execSync } from 'child_process';
import { load as loadConfig } from '../shared/config.js';
import { readState } from '../state.js';
import type { RepoId } from '../shared/identity.js';
import { EnvironmentNotRunningError, PodNotFoundError } from '../shared/errors.js';
import type { ShellCommand } from './types.js';

/**
 * Get the kubectl exec command parts for opening a shell in a service pod.
 *
 * Returns command parts instead of spawning — the consumer controls the PTY.
 * Throws EnvironmentNotRunningError if no state, PodNotFoundError if no pod.
 */
export async function getShellCommand(
  repo: RepoId,
  service: string,
): Promise<ShellCommand> {
  const config = await loadConfig(repo);
  const state = readState(config);

  if (!state) {
    throw new EnvironmentNotRunningError();
  }

  const targets = config.utilities?.shellTargets ?? [];
  const target = targets.find(t => t.name === service);

  if (!target) {
    throw new Error(
      `Unknown shell target: ${service}. Available: ${targets.map(t => t.name).join(', ')}`,
    );
  }

  const podSelector = target.podSelector ?? `app=${service}`;
  const shell = target.shell ?? '/bin/sh';

  // Get the first pod for this service
  let podName: string;
  try {
    podName = execSync(
      `kubectl get pods -n ${state.namespace} -l ${podSelector} -o jsonpath='{.items[0].metadata.name}'`,
      { encoding: 'utf-8' },
    )
      .trim()
      .replace(/'/g, '');
  } catch {
    throw new PodNotFoundError(service);
  }

  if (!podName) {
    throw new PodNotFoundError(service);
  }

  return {
    command: 'kubectl',
    args: ['exec', '-n', state.namespace, '-it', podName, '--', shell],
    namespace: state.namespace,
  };
}
