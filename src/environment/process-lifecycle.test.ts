import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';

import { killProcess } from './process-kill.js';

describe('killProcess', () => {
  let childPids: number[] = [];

  afterEach(() => {
    // Clean up any spawned processes
    for (const pid of childPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }
    childPids = [];
  });

  it('returns killed=true for an already-dead process', async () => {
    const result = await killProcess(999999);
    expect(result.killed).toBe(true);
    expect(result.escalated).toBe(false);
  });

  it('kills a running process with SIGTERM', async () => {
    // Spawn a simple process that will respond to SIGTERM
    const child = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    child.unref();
    childPids.push(child.pid!);

    const result = await killProcess(child.pid!, 2000);

    expect(result.killed).toBe(true);
    expect(result.escalated).toBe(false);
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    // Spawn a process that traps SIGTERM (ignores it)
    const child = spawn('bash', ['-c', 'trap "" TERM; sleep 60'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    childPids.push(child.pid!);

    // Give bash time to set up the trap
    await new Promise(resolve => setTimeout(resolve, 100));

    const result = await killProcess(child.pid!, 500);

    expect(result.killed).toBe(true);
    expect(result.escalated).toBe(true);
  });
});
