/**
 * Signal handler registration for clean process shutdown.
 *
 * Ensures grove-managed child processes (kubectl, dev servers) are
 * cleaned up when the parent process receives SIGINT or SIGTERM.
 */

import type { RepoId } from '../shared/identity.js';

type CleanupFn = () => Promise<void>;

let cleanupHandler: CleanupFn | null = null;
let signalListeners: { signal: NodeJS.Signals; listener: NodeJS.SignalsListener }[] = [];

/**
 * Register signal handlers that call down() for the given repo on SIGINT/SIGTERM.
 * Only one cleanup handler can be active at a time — calling this again replaces the previous one.
 */
export function registerCleanupHandler(downFn: (repo: RepoId) => Promise<unknown>, repo: RepoId): void {
  // Remove any existing handler first
  unregisterCleanupHandler();

  cleanupHandler = async () => {
    try {
      await downFn(repo);
    } catch {
      // Best-effort cleanup
    }
  };

  const makeListener = (signal: NodeJS.Signals): NodeJS.SignalsListener => {
    const listener = () => {
      if (cleanupHandler) {
        cleanupHandler().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
      } else {
        process.exit(signal === 'SIGINT' ? 130 : 143);
      }
    };
    return listener;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const listener = makeListener(signal);
    process.on(signal, listener);
    signalListeners.push({ signal, listener });
  }
}

/**
 * Remove all signal handlers registered by registerCleanupHandler.
 */
export function unregisterCleanupHandler(): void {
  for (const { signal, listener } of signalListeners) {
    process.removeListener(signal, listener);
  }
  signalListeners = [];
  cleanupHandler = null;
}
