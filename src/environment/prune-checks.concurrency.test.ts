import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState, StaleStateFileEntry } from './types.js';
import { writeState } from './state.js';
import { cleanStaleStateFiles, cleanStoppedProcesses, cleanDanglingPorts } from './prune-checks.js';

function makeConfig(repoRoot: string): GroveConfig {
  return {
    project: { name: 'testapp', cluster: 'twiglylabs-local' },
    helm: { chart: 'chart', release: 'testapp', valuesFiles: ['values.yaml'] },
    services: [
      { name: 'api', portForward: { remotePort: 3001 }, health: { path: '/health', protocol: 'http' } },
      { name: 'worker' },
    ],
    frontends: [
      { name: 'webapp', command: 'npm start', cwd: 'webapp' },
    ],
    portBlockSize: 3,
    repoRoot,
  } as GroveConfig;
}

function makeState(worktreeId: string, ports: Record<string, number>, processes: Record<string, { pid: number; startedAt: string }> = {}): EnvironmentState {
  const urls: Record<string, string> = {};
  for (const [name, port] of Object.entries(ports)) {
    urls[name] = `http://127.0.0.1:${port}`;
  }
  return {
    namespace: `testapp-${worktreeId}`,
    branch: worktreeId,
    worktreeId,
    ports,
    urls,
    processes,
    lastEnsure: new Date().toISOString(),
  };
}

describe('prune-checks concurrency', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `grove-prune-concurrency-${process.pid}-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('cleanStaleStateFiles concurrent with writeState', () => {
    it('prune on stale file does not affect concurrent write to active file', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // Create an active and a stale state file
      await writeState(makeState('active-branch', { api: 10000, webapp: 10001 }), config);
      await writeState(makeState('stale-branch', { api: 10003, webapp: 10004 }), config);

      const staleEntries: StaleStateFileEntry[] = [
        { file: 'stale-branch.json', worktreeId: 'stale-branch' },
      ];

      // Concurrently: prune deletes stale, writeState updates active
      await Promise.all([
        new Promise<void>(resolve => {
          cleanStaleStateFiles(config, staleEntries);
          resolve();
        }),
        writeState(makeState('active-branch', { api: 10006, webapp: 10007 }), config),
      ]);

      const stateDir = join(testDir, '.grove');

      // Active file should be intact with updated ports
      const content = readFileSync(join(stateDir, 'active-branch.json'), 'utf-8');
      const state: EnvironmentState = JSON.parse(content);
      expect(state.worktreeId).toBe('active-branch');
      expect(state.ports.api).toBe(10006);

      // Stale file should be gone
      expect(existsSync(join(stateDir, 'stale-branch.json'))).toBe(false);
    });

    it('prune deletion concurrent with writeState on same file (prune-during-up race)', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // Prune identified this file as stale (TOCTOU: between find and clean, up() may re-create it)
      await writeState(makeState('contested', { api: 10000, webapp: 10001 }), config);

      const staleEntries: StaleStateFileEntry[] = [
        { file: 'contested.json', worktreeId: 'contested' },
      ];

      // Race: prune deletes the file, writeState (simulating up()) updates it.
      // Either outcome is valid — the lock serializes the operations.
      await Promise.all([
        new Promise<void>(resolve => {
          cleanStaleStateFiles(config, staleEntries);
          resolve();
        }),
        writeState(makeState('contested', { api: 10003, webapp: 10004 }), config),
      ]);

      const filePath = join(testDir, '.grove', 'contested.json');
      if (existsSync(filePath)) {
        // If file survived, it must be valid JSON with expected structure
        const content = readFileSync(filePath, 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        expect(state.worktreeId).toBe('contested');
        expect(typeof state.ports.api).toBe('number');
      }
      // If file is gone, prune won — also a valid serialized outcome
    });

    it('multiple stale files pruned concurrent with multiple writes', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // 5 active + 5 stale
      for (let i = 0; i < 5; i++) {
        await writeState(makeState(`active-${i}`, { api: 10000 + i * 3, webapp: 10001 + i * 3 }), config);
        await writeState(makeState(`stale-${i}`, { api: 20000 + i * 3, webapp: 20001 + i * 3 }), config);
      }

      const staleEntries: StaleStateFileEntry[] = Array.from({ length: 5 }, (_, i) => ({
        file: `stale-${i}.json`,
        worktreeId: `stale-${i}`,
      }));

      // Concurrently: prune stale files + update active files
      await Promise.all([
        new Promise<void>(resolve => {
          cleanStaleStateFiles(config, staleEntries);
          resolve();
        }),
        ...Array.from({ length: 5 }, (_, i) =>
          writeState(makeState(`active-${i}`, { api: 30000 + i * 3, webapp: 30001 + i * 3 }), config),
        ),
      ]);

      const stateDir = join(testDir, '.grove');

      // All stale files should be gone
      for (let i = 0; i < 5; i++) {
        expect(existsSync(join(stateDir, `stale-${i}.json`))).toBe(false);
      }

      // All active files should be intact with updated data
      for (let i = 0; i < 5; i++) {
        const content = readFileSync(join(stateDir, `active-${i}.json`), 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        expect(state.worktreeId).toBe(`active-${i}`);
        expect(state.ports.api).toBe(30000 + i * 3);
      }
    });
  });

  describe('cleanStoppedProcesses concurrent with writeState', () => {
    it('process cleanup does not corrupt concurrent state writes', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // Create state with stopped processes (PID 999999 is almost certainly not running)
      const stateWithProcesses = makeState(
        'branch-a',
        { api: 10000, webapp: 10001 },
        {
          'port-forward-api': { pid: 999999, startedAt: '2026-02-20T10:00:00Z' },
          'webapp': { pid: 999998, startedAt: '2026-02-20T10:00:00Z' },
        },
      );
      await writeState(stateWithProcesses, config);

      // Also create a separate state file being written concurrently
      await writeState(makeState('branch-b', { api: 10003, webapp: 10004 }), config);

      const entries = [
        { stateFile: 'branch-a.json', processName: 'port-forward-api', pid: 999999 },
        { stateFile: 'branch-a.json', processName: 'webapp', pid: 999998 },
      ];

      // Concurrently: clean stopped processes from branch-a + write updates to branch-b
      await Promise.all([
        cleanStoppedProcesses(config, entries),
        writeState(makeState('branch-b', { api: 10006, webapp: 10007 }), config),
      ]);

      // branch-b should be intact
      const bContent = readFileSync(join(testDir, '.grove', 'branch-b.json'), 'utf-8');
      const bState: EnvironmentState = JSON.parse(bContent);
      expect(bState.worktreeId).toBe('branch-b');
      expect(bState.ports.api).toBe(10006);

      // branch-a should have processes cleaned
      const aContent = readFileSync(join(testDir, '.grove', 'branch-a.json'), 'utf-8');
      const aState: EnvironmentState = JSON.parse(aContent);
      expect(aState.worktreeId).toBe('branch-a');
      expect(aState.processes['port-forward-api']).toBeUndefined();
      expect(aState.processes['webapp']).toBeUndefined();
    });
  });

  describe('cleanDanglingPorts concurrent with writeState', () => {
    it('dangling port cleanup does not corrupt concurrent state writes', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // Create state with ports but no running processes (all ports are "dangling")
      await writeState(makeState('branch-a', { api: 10000, webapp: 10001 }), config);
      await writeState(makeState('branch-b', { api: 10003, webapp: 10004 }), config);

      const entries = [
        { stateFile: 'branch-a.json', portName: 'api', port: 10000 },
        { stateFile: 'branch-a.json', portName: 'webapp', port: 10001 },
      ];

      // Concurrently: clean dangling ports from branch-a + write updates to branch-b
      await Promise.all([
        cleanDanglingPorts(config, entries),
        writeState(makeState('branch-b', { api: 10006, webapp: 10007 }), config),
      ]);

      // branch-b should be intact
      const bContent = readFileSync(join(testDir, '.grove', 'branch-b.json'), 'utf-8');
      const bState: EnvironmentState = JSON.parse(bContent);
      expect(bState.worktreeId).toBe('branch-b');
      expect(bState.ports.api).toBe(10006);

      // branch-a should have dangling ports cleaned
      const aContent = readFileSync(join(testDir, '.grove', 'branch-a.json'), 'utf-8');
      const aState: EnvironmentState = JSON.parse(aContent);
      expect(aState.worktreeId).toBe('branch-a');
      expect(aState.ports.api).toBeUndefined();
      expect(aState.ports.webapp).toBeUndefined();
      expect(aState.urls.api).toBeUndefined();
      expect(aState.urls.webapp).toBeUndefined();
    });
  });
});
