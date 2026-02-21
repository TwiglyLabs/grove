import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';

// We test killProcess by importing it from api.ts
// Since api.ts has many dependencies, we mock them away
vi.mock('../shared/config.js', () => ({
  load: vi.fn(),
}));

vi.mock('./state.js', () => ({
  readState: vi.fn(),
  writeState: vi.fn(),
  releasePortBlock: vi.fn(),
}));

vi.mock('./controller.js', () => ({
  ensureEnvironment: vi.fn(),
}));

vi.mock('./watcher.js', () => ({
  FileWatcher: vi.fn(),
}));

vi.mock('./processes/BuildOrchestrator.js', () => ({
  BuildOrchestrator: vi.fn(),
}));

vi.mock('./providers/index.js', () => ({
  createClusterProvider: vi.fn(),
}));

vi.mock('./timing.js', () => ({
  Timer: vi.fn().mockImplementation(() => ({
    elapsed: () => 0,
    format: () => '0s',
  })),
}));

import { killProcess } from './api.js';

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
