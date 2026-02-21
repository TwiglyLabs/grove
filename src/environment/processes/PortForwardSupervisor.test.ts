import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GroveConfig, Service } from '../../config.js';
import type { EnvironmentState, ProcessInfo } from '../types.js';
import type { PortForwardConfig } from './PortForwardProcess.js';
import type { SupervisorEvents } from './PortForwardSupervisor.js';

const mockCheckHealth = vi.fn();
const mockWriteState = vi.fn();
const mockStopByPid = vi.fn();
const mockPfStart = vi.fn();

vi.mock('../health.js', () => ({
  checkHealth: (...args: unknown[]) => mockCheckHealth(...args),
}));

vi.mock('../state.js', () => ({
  writeState: (...args: unknown[]) => mockWriteState(...args),
}));

vi.mock('./PortForwardProcess.js', () => ({
  PortForwardProcess: class MockPortForwardProcess {
    constructor(public config: PortForwardConfig) {}
    async start() { return mockPfStart(); }
    static async stopByPid(pid: number) { return mockStopByPid(pid); }
  },
}));

import { PortForwardSupervisor } from './PortForwardSupervisor.js';

function makeConfig(): GroveConfig {
  return {
    project: { name: 'test-app', cluster: 'test-cluster', clusterType: 'kind' },
    repoRoot: '/tmp/test-repo',
    services: [
      {
        name: 'api',
        portForward: { remotePort: 3000 },
        health: { path: '/health', protocol: 'http' },
      },
    ],
    helm: { chart: './chart', release: 'test', valuesFiles: ['values.yaml'] },
    portBlockSize: 2,
  } as GroveConfig;
}

function makeState(): EnvironmentState {
  return {
    namespace: 'test-app-main',
    branch: 'main',
    worktreeId: 'main',
    ports: { api: 10000 },
    urls: { api: 'http://127.0.0.1:10000' },
    processes: { 'port-forward-api': { pid: 12345, startedAt: '2026-02-20T00:00:00Z' } },
    lastEnsure: new Date().toISOString(),
  };
}

function makeService(): Service {
  return {
    name: 'api',
    portForward: { remotePort: 3000 },
    health: { path: '/health', protocol: 'http' },
  } as Service;
}

function makePfConfig(): PortForwardConfig {
  return {
    namespace: 'test-app-main',
    serviceName: 'api',
    remotePort: 3000,
    localPort: 10000,
    hostIp: '127.0.0.1',
  };
}

function makeProcessInfo(): ProcessInfo {
  return { pid: 12345, startedAt: '2026-02-20T00:00:00Z' };
}

// Use zero backoff for tests
const instantOptions = {
  checkIntervalMs: 100,
  maxRecoveryAttempts: 3,
  backoffMultiplier: 1,
};

describe('PortForwardSupervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckHealth.mockResolvedValue(true);
    mockWriteState.mockResolvedValue(undefined);
    mockStopByPid.mockResolvedValue({ killed: true, escalated: false });
    mockPfStart.mockResolvedValue({ pid: 99999, startedAt: new Date().toISOString() });
  });

  describe('checkAll', () => {
    it('returns healthy results when all forwards are healthy', async () => {
      mockCheckHealth.mockResolvedValue(true);

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, instantOptions);
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      const results = await supervisor.checkAll();

      expect(results).toHaveLength(1);
      expect(results[0].service).toBe('api');
      expect(results[0].healthy).toBe(true);
      expect(results[0].recovered).toBe(false);
    });

    it('resets failure counter on healthy check', async () => {
      const events: SupervisorEvents = {
        onHealthCheck: vi.fn(),
      };

      mockCheckHealth
        .mockResolvedValueOnce(false) // First check: unhealthy → triggers recovery
        .mockResolvedValue(true);     // Subsequent: healthy

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), events, {
        ...instantOptions,
        backoffMultiplier: 0, // No delay
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      // First check — unhealthy, triggers recovery
      await supervisor.checkAll();

      // Second check — healthy, resets counter
      const results = await supervisor.checkAll();
      expect(results[0].healthy).toBe(true);
    });

    it('fires onHealthCheck event', async () => {
      const events: SupervisorEvents = {
        onHealthCheck: vi.fn(),
      };

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), events, instantOptions);
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      await supervisor.checkAll();

      expect(events.onHealthCheck).toHaveBeenCalledWith('api', true);
    });
  });

  describe('recovery', () => {
    it('attempts recovery when health check fails', async () => {
      mockCheckHealth.mockResolvedValue(false);
      const newPid = 99999;
      mockPfStart.mockResolvedValue({ pid: newPid, startedAt: new Date().toISOString() });

      const events: SupervisorEvents = {
        onRecovery: vi.fn(),
        onHealthCheck: vi.fn(),
      };

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), events, {
        ...instantOptions,
        backoffMultiplier: 0,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      const results = await supervisor.checkAll();

      expect(mockStopByPid).toHaveBeenCalledWith(12345);
      expect(mockPfStart).toHaveBeenCalled();
      expect(events.onRecovery).toHaveBeenCalledWith('api', 1, true);
      expect(results[0].recovered).toBe(true);
    });

    it('updates state with new PID after recovery', async () => {
      mockCheckHealth.mockResolvedValue(false);
      const newPid = 99999;
      mockPfStart.mockResolvedValue({ pid: newPid, startedAt: '2026-02-20T01:00:00Z' });

      const state = makeState();
      const supervisor = new PortForwardSupervisor(makeConfig(), state, undefined, {
        ...instantOptions,
        backoffMultiplier: 0,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      await supervisor.checkAll();

      expect(state.processes['port-forward-api'].pid).toBe(newPid);
      expect(mockWriteState).toHaveBeenCalled();
    });

    it('gives up after max recovery attempts', async () => {
      mockCheckHealth.mockResolvedValue(false);
      mockPfStart.mockRejectedValue(new Error('cannot forward'));

      const events: SupervisorEvents = {
        onGiveUp: vi.fn(),
        onRecovery: vi.fn(),
        onHealthCheck: vi.fn(),
      };

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), events, {
        ...instantOptions,
        maxRecoveryAttempts: 2,
        backoffMultiplier: 0,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      // Attempt 1 — fails recovery
      await supervisor.checkAll();
      // Attempt 2 — gives up (failureCount >= maxRecoveryAttempts)
      await supervisor.checkAll();

      expect(events.onGiveUp).toHaveBeenCalledWith('api', 2);
    });

    it('skips recovery when forward is already recovering', async () => {
      // Directly test the guard: set recovering=true on the forward, then checkAll
      mockCheckHealth.mockResolvedValue(false);

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, {
        ...instantOptions,
        backoffMultiplier: 0,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      // Manually set recovering flag via internal state
      const forward = (supervisor as any).forwards.get('api');
      forward.recovering = true;

      // checkAll should skip this forward entirely (recovering guard at top of loop)
      const results = await supervisor.checkAll();
      expect(results[0].healthy).toBe(false);
      expect(results[0].recovered).toBe(false);
      expect(mockStopByPid).not.toHaveBeenCalled();
    });
  });

  describe('lifecycle', () => {
    it('stop() cancels the timer', async () => {
      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, instantOptions);
      supervisor.start();

      // Should not throw
      await supervisor.stop();
      await supervisor.stop(); // Double-stop is safe
    });

    it('start() is idempotent', async () => {
      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, instantOptions);
      supervisor.start();
      supervisor.start(); // Should not start a second timer

      await supervisor.stop();
    });

    it('stop() awaits in-flight checkAll', async () => {
      let resolveHealth!: (value: boolean) => void;

      mockCheckHealth.mockImplementation(() => {
        return new Promise<boolean>(r => { resolveHealth = r; });
      });

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, {
        checkIntervalMs: 10, // Very short interval to trigger quickly
        maxRecoveryAttempts: 3,
        backoffMultiplier: 1,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());
      supervisor.start();

      // Wait for the interval to fire and checkAll to begin (health check will block)
      await new Promise(r => setTimeout(r, 50));

      // Now stop — should not resolve until the in-flight checkAll finishes
      let stopResolved = false;
      const stopPromise = supervisor.stop().then(() => { stopResolved = true; });

      // Give the event loop a chance — stop should still be waiting
      await new Promise(r => setTimeout(r, 10));
      expect(stopResolved).toBe(false);

      // Unblock the health check — checkAll finishes, then stop finishes
      resolveHealth(true);
      await stopPromise;
      expect(stopResolved).toBe(true);
    });

    it('attemptRecovery bails out after stop()', async () => {
      mockCheckHealth.mockResolvedValue(false);

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, {
        ...instantOptions,
        backoffMultiplier: 0,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      // Simulate stop() having been called (sets stopped=true)
      await supervisor.stop();

      const results = await supervisor.checkAll();

      // Recovery should not have been attempted since stopped=true
      expect(mockStopByPid).not.toHaveBeenCalled();
      expect(mockPfStart).not.toHaveBeenCalled();
      expect(results[0].recovered).toBe(false);
    });

    it('skips already gave-up services', async () => {
      mockCheckHealth.mockResolvedValue(false);
      mockPfStart.mockRejectedValue(new Error('fail'));

      const events: SupervisorEvents = {
        onGiveUp: vi.fn(),
      };

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), events, {
        ...instantOptions,
        maxRecoveryAttempts: 1,
        backoffMultiplier: 0,
      });
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      // Exhaust recovery attempts — gives up after 1 (failureCount >= maxRecoveryAttempts)
      await supervisor.checkAll();

      // Further checks skip this service
      const results = await supervisor.checkAll();
      expect(results[0].gaveUp).toBe(true);
      expect(results[0].healthy).toBe(false);
    });
  });

  describe('events', () => {
    it('works without events (no crash when undefined)', async () => {
      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), undefined, instantOptions);
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      await expect(supervisor.checkAll()).resolves.toBeDefined();
    });

    it('fires onHealthCheck for each service', async () => {
      const events: SupervisorEvents = {
        onHealthCheck: vi.fn(),
      };

      const supervisor = new PortForwardSupervisor(makeConfig(), makeState(), events, instantOptions);
      supervisor.register(makeService(), makePfConfig(), makeProcessInfo());

      await supervisor.checkAll();

      expect(events.onHealthCheck).toHaveBeenCalledWith('api', true);
    });
  });
});
