import { spawn } from 'child_process';
import { openSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Frontend } from '../config.js';
import type { EnvironmentState, ProcessInfo } from '../state.js';
import { resolveTemplates } from '../template.js';
import { checkHealth } from '../health.js';

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

    // Parse command (simple split on spaces - assumes no quoted args with spaces)
    const [cmd, ...args] = this.config.command.split(' ');

    const child = spawn(cmd, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', out, err],
    });

    child.unref();

    return {
      pid: child.pid!,
      startedAt: new Date().toISOString(),
    };
  }

  async stop(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      // Process might already be dead
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
