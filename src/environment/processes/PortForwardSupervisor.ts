import { join } from 'path';
import type { GroveConfig, Service } from '../../config.js';
import type { EnvironmentState, ProcessInfo } from '../types.js';
import { checkHealth } from '../health.js';
import { writeState } from '../state.js';
import { PortForwardProcess, type PortForwardConfig } from './PortForwardProcess.js';

export interface SupervisorEvents {
  onHealthCheck?(service: string, healthy: boolean): void;
  onRecovery?(service: string, attempt: number, success: boolean): void;
  onGiveUp?(service: string, attempts: number): void;
}

export interface SupervisorOptions {
  checkIntervalMs?: number;
  maxRecoveryAttempts?: number;
  backoffMultiplier?: number;
}

interface RegisteredForward {
  service: Service;
  pfConfig: PortForwardConfig;
  processInfo: ProcessInfo;
  failureCount: number;
  recovering: boolean;
  gaveUp: boolean;
}

export interface SupervisorHealthCheckResult {
  service: string;
  healthy: boolean;
  recovered: boolean;
  gaveUp: boolean;
}

export class PortForwardSupervisor {
  private forwards: Map<string, RegisteredForward> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private checkIntervalMs: number;
  private maxRecoveryAttempts: number;
  private backoffMultiplier: number;

  constructor(
    private config: GroveConfig,
    private state: EnvironmentState,
    private events?: SupervisorEvents,
    options?: SupervisorOptions,
  ) {
    this.checkIntervalMs = options?.checkIntervalMs ?? 15_000;
    this.maxRecoveryAttempts = options?.maxRecoveryAttempts ?? 3;
    this.backoffMultiplier = options?.backoffMultiplier ?? 2;
  }

  register(service: Service, pfConfig: PortForwardConfig, processInfo: ProcessInfo): void {
    this.forwards.set(service.name, {
      service,
      pfConfig,
      processInfo,
      failureCount: 0,
      recovering: false,
      gaveUp: false,
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => {
      this.checkAll().catch(() => {});
    }, this.checkIntervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAll(): Promise<SupervisorHealthCheckResult[]> {
    const results: SupervisorHealthCheckResult[] = [];

    for (const [name, forward] of this.forwards) {
      if (forward.gaveUp || forward.recovering) {
        results.push({
          service: name,
          healthy: false,
          recovered: false,
          gaveUp: forward.gaveUp,
        });
        continue;
      }

      const { service, pfConfig } = forward;
      const port = pfConfig.localPort;
      const host = pfConfig.hostIp || '127.0.0.1';
      const protocol = service.health?.protocol || 'http';
      const path = service.health?.path || '/';

      const healthy = await checkHealth(protocol, host, port, path);
      this.events?.onHealthCheck?.(name, healthy);

      if (healthy) {
        forward.failureCount = 0;
        results.push({ service: name, healthy: true, recovered: false, gaveUp: false });
      } else {
        forward.failureCount++;

        if (forward.failureCount >= this.maxRecoveryAttempts) {
          forward.gaveUp = true;
          this.events?.onGiveUp?.(name, forward.failureCount);
          results.push({ service: name, healthy: false, recovered: false, gaveUp: true });
        } else if (forward.recovering) {
          // Another concurrent checkAll is already recovering this forward
          results.push({ service: name, healthy: false, recovered: false, gaveUp: false });
        } else {
          const recovered = await this.attemptRecovery(forward);
          results.push({ service: name, healthy: recovered, recovered, gaveUp: false });
        }
      }
    }

    return results;
  }

  private async attemptRecovery(forward: RegisteredForward): Promise<boolean> {
    forward.recovering = true;
    const attempt = forward.failureCount;

    try {
      // Backoff delay
      const delay = 1000 * Math.pow(this.backoffMultiplier, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Stop old process
      await PortForwardProcess.stopByPid(forward.processInfo.pid);

      // Spawn new port-forward
      const logsDir = join(this.config.repoRoot, '.grove', 'logs');
      const newPf = new PortForwardProcess(forward.pfConfig);
      const newProcessInfo = await newPf.start(logsDir);

      // Update state
      forward.processInfo = newProcessInfo;
      const processKey = `port-forward-${forward.service.name}`;
      this.state.processes[processKey] = newProcessInfo;

      // Write state atomically
      try {
        await writeState(this.state, this.config);
      } catch {
        // Best-effort state write
      }

      this.events?.onRecovery?.(forward.service.name, attempt, true);
      forward.failureCount = 0;
      return true;
    } catch {
      this.events?.onRecovery?.(forward.service.name, attempt, false);
      return false;
    } finally {
      forward.recovering = false;
    }
  }
}
