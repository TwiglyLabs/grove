/**
 * Process termination with SIGTERM→wait→SIGKILL escalation.
 *
 * Extracted from api.ts so controller.ts can use it during rollback
 * without a circular dependency.
 */

import { isProcessRunning } from './process-check.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Kill a process with SIGTERM→wait→SIGKILL escalation.
 * Returns whether the process was killed and whether SIGKILL was needed.
 */
export async function killProcess(
  pid: number,
  timeoutMs: number = 5000,
): Promise<{ killed: boolean; escalated: boolean }> {
  if (!isProcessRunning(pid)) {
    return { killed: true, escalated: false };
  }

  // Phase 1: SIGTERM
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return { killed: true, escalated: false };
  }

  // Phase 2: Poll for death
  const pollInterval = 100;
  const maxPolls = Math.ceil(timeoutMs / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollInterval);
    if (!isProcessRunning(pid)) {
      return { killed: true, escalated: false };
    }
  }

  // Phase 3: SIGKILL escalation
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    return { killed: true, escalated: true };
  }

  // Phase 4: Verify dead
  await sleep(200);
  const dead = !isProcessRunning(pid);
  return { killed: dead, escalated: true };
}
