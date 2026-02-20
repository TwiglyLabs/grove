import { spawn } from 'child_process';
import { openSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ProcessInfo } from '../types.js';

export interface PortForwardConfig {
  namespace: string;
  serviceName: string;
  remotePort: number;
  localPort: number;
  hostIp?: string;
}

export class PortForwardProcess {
  constructor(private config: PortForwardConfig) {}

  async start(logsDir: string): Promise<ProcessInfo> {
    const { namespace, serviceName, remotePort, localPort, hostIp = '127.0.0.1' } = this.config;

    // Ensure logs directory exists
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }

    const logFile = join(logsDir, `port-forward-${serviceName}.log`);

    // Open file descriptors for stdout/stderr logging
    const out = openSync(logFile, 'w');
    const err = openSync(logFile, 'a');

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

    const child = spawn('kubectl', args, {
      detached: true,
      stdio: ['ignore', out, err],
    });

    child.unref();

    // Wait a bit for the port forward to establish
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      pid: child.pid!,
      startedAt: new Date().toISOString(),
    };
  }

  static async stopByPid(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      // Process might already be dead
    }
  }
}
