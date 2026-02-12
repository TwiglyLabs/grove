import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { Frontend } from '../config.js';
import type { ProcessInfo } from '../state.js';
import { checkHealth } from '../health.js';

export class GenericDevServer {
  private process: ChildProcess | null = null;

  constructor(
    private config: Frontend,
    private port: number
  ) {}

  async start(repoRoot: string, logsDir: string): Promise<ProcessInfo> {
    // Ensure logs directory exists
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const logFile = join(logsDir, `${this.config.name}.log`);
    writeFileSync(logFile, '', { flag: 'w' });

    const cwd = join(repoRoot, this.config.cwd);

    // Prepare environment
    const env = {
      ...process.env,
      PORT: String(this.port),
      ...this.config.env,
    };

    // Parse command (simple split on spaces - assumes no quoted args with spaces)
    const [cmd, ...args] = this.config.command.split(' ');

    this.process = spawn(cmd, args, {
      cwd,
      env,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Write logs
    this.process.stdout?.on('data', (data) => {
      writeFileSync(logFile, data, { flag: 'a' });
    });

    this.process.stderr?.on('data', (data) => {
      writeFileSync(logFile, data, { flag: 'a' });
    });

    this.process.on('exit', (code) => {
      const message = `${this.config.name} exited with code ${code}\n`;
      writeFileSync(logFile, message, { flag: 'a' });
    });

    return {
      pid: this.process.pid!,
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
