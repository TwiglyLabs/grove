import { spawn } from 'child_process';
import { closeSync, openSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Frontend } from '../../config.js';
import type { EnvironmentState, ProcessInfo } from '../types.js';
import { resolveTemplates } from '../template.js';
import { checkHealth } from '../health.js';
import { FrontendStartFailedError } from '../../shared/errors.js';

export class GenericDevServer {
  constructor(
    private config: Frontend,
    private port: number
  ) {}

  async start(repoRoot: string, logsDir: string, state?: EnvironmentState): Promise<ProcessInfo> {
    // Ensure logs directory exists
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const logFile = join(logsDir, `${this.config.name}.log`);
    const cwd = join(repoRoot, this.config.cwd);

    // Resolve template variables in env vars
    const resolvedEnv = state && this.config.env
      ? resolveTemplates(this.config.env, state)
      : this.config.env || {};

    // Prepare environment
    const env = {
      ...process.env,
      PORT: String(this.port),
      ...resolvedEnv,
    };

    // Open file descriptors for stdout/stderr logging
    const out = openSync(logFile, 'w');
    const err = openSync(logFile, 'a');

    // Use shell: true so the OS handles quoted arguments correctly
    const child = spawn(this.config.command, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', out, err],
      shell: true,
    });

    child.unref();

    // Close FDs in the parent process — the child has its own copies
    closeSync(out);
    closeSync(err);

    const pid = child.pid;
    if (pid === undefined) {
      throw new FrontendStartFailedError(this.config.name, 'spawn returned no PID');
    }

    // Brief pause to let the child process fail fast if command is invalid
    await new Promise(resolve => setTimeout(resolve, 200));

    // Liveness check: verify the process is still alive
    try {
      process.kill(pid, 0);
    } catch {
      throw new FrontendStartFailedError(this.config.name, 'process exited immediately');
    }

    return {
      pid,
      startedAt: new Date().toISOString(),
    };
  }

  async stop(pid: number, timeoutMs: number = 5000): Promise<{ killed: boolean; escalated: boolean }> {
    // Check if already dead
    try {
      process.kill(pid, 0);
    } catch {
      return { killed: true, escalated: false };
    }

    // SIGTERM
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return { killed: true, escalated: false };
    }

    // Poll for death
    const pollInterval = 100;
    const maxPolls = Math.ceil(timeoutMs / pollInterval);
    for (let i = 0; i < maxPolls; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      try {
        process.kill(pid, 0);
      } catch {
        return { killed: true, escalated: false };
      }
    }

    // SIGKILL escalation
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return { killed: true, escalated: true };
    }

    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      process.kill(pid, 0);
      return { killed: false, escalated: true };
    } catch {
      return { killed: true, escalated: true };
    }
  }

  async isHealthy(): Promise<boolean> {
    if (!this.config.health) {
      return true; // No health check configured
    }

    const { protocol = 'http', path = '/' } = this.config.health;
    return checkHealth(protocol, '127.0.0.1', this.port, path);
  }
}
