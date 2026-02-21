/**
 * Process identity and liveness checks.
 *
 * Guards against PID reuse: verifies a PID belongs to a grove-managed process
 * before treating it as alive. Prevents SIGTERM-ing unrelated processes after
 * a reboot or PID wrap.
 */

import { execSync } from 'child_process';

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort check that a PID belongs to a grove-managed process.
 * Uses `ps` to inspect the command name — guards against PID reuse
 * where an unrelated process inherits a stale PID from state.
 */
export function isGroveProcess(pid: number): boolean {
  if (!isProcessRunning(pid)) return false;
  try {
    const comm = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8', timeout: 2000 }).trim();
    // grove-managed processes are kubectl port-forwards, shell commands, or node-based dev servers
    const groveCommands = ['kubectl', 'node', 'npm', 'npx', 'bash', 'sh', 'sleep'];
    return groveCommands.some(cmd => comm.includes(cmd));
  } catch {
    // ps failed — fall back to kill(pid, 0) which already passed above
    return true;
  }
}
