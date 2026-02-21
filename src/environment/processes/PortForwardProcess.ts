import { spawn } from 'child_process';
import { closeSync, openSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ProcessInfo } from '../types.js';
import { checkTcpReady } from '../health.js';
import { PortForwardFailedError } from '../../shared/errors.js';

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

    let child;
    try {
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

      child = spawn('kubectl', args, {
        detached: true,
        stdio: ['ignore', out, err],
      });

      child.unref();
    } finally {
      // Close FDs in the parent process — the child has its own copies.
      // Must close even if spawn() throws to prevent FD leaks.
      closeSync(out);
      closeSync(err);
    }

    const pid = child.pid;
    if (pid === undefined) {
      throw new PortForwardFailedError(serviceName, localPort);
    }

    // Verify port is actually bound (15s timeout to accommodate VM-based runtimes like Colima)
    const bound = await checkTcpReady(hostIp, localPort, 15000, 300);
    if (!bound) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
      throw new PortForwardFailedError(serviceName, localPort);
    }

    return {
      pid,
      startedAt: new Date().toISOString(),
    };
  }

  static async stopByPid(pid: number, timeoutMs: number = 5000): Promise<{ killed: boolean; escalated: boolean }> {
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
}
