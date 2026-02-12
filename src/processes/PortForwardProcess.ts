import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ProcessInfo } from '../state.js';

export interface PortForwardConfig {
  namespace: string;
  serviceName: string;
  remotePort: number;
  localPort: number;
  hostIp?: string;
}

export class PortForwardProcess {
  private process: ChildProcess | null = null;

  constructor(private config: PortForwardConfig) {}

  async start(logsDir: string): Promise<ProcessInfo> {
    const { namespace, serviceName, remotePort, localPort, hostIp = '127.0.0.1' } = this.config;

    // Ensure logs directory exists
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const logFile = join(logsDir, `port-forward-${serviceName}.log`);
    const logStream = writeFileSync(logFile, '', { flag: 'w' });

    // kubectl port-forward -n <namespace> svc/<service> <localPort>:<remotePort> --address <hostIp>
    const args = [
      'port-forward',
      '-n',
      namespace,
      `svc/${serviceName}`,
      `${localPort}:${remotePort}`,
      '--address',
      hostIp,
    ];

    this.process = spawn('kubectl', args, {
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
      const message = `Port forward exited with code ${code}\n`;
      writeFileSync(logFile, message, { flag: 'a' });
    });

    // Wait a bit for the port forward to establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      pid: this.process.pid!,
      startedAt: new Date().toISOString(),
    };
  }

  async stop(): Promise<void> {
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
  }

  static async stopByPid(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      // Process might already be dead
    }
  }
}
