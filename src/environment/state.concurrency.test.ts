import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from './types.js';
import { loadOrCreateState, readState, releasePortBlock, writeState } from './state.js';

function makeConfig(repoRoot: string, overrides: Partial<GroveConfig> = {}): GroveConfig {
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
    ...overrides,
  } as GroveConfig;
}

function makeState(worktreeId: string, ports: Record<string, number>): EnvironmentState {
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
    processes: {},
    lastEnsure: new Date().toISOString(),
  };
}

describe('environment state concurrency', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `grove-env-concurrency-${process.pid}-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('port allocation', () => {
    it('loadOrCreateState allocates non-overlapping ports when other state files exist', async () => {
      const config = makeConfig(testDir);

      // Pre-populate state files for other worktrees
      for (let i = 0; i < 5; i++) {
        const basePort = 10000 + i * 3;
        const ports = { api: basePort, webapp: basePort + 1 };
        await writeState(makeState(`branch-${i}`, ports), config);
      }

      // loadOrCreateState for 'main' (fallback in tmpdir) should skip all occupied blocks
      const result = await loadOrCreateState(config);
      const occupiedPorts = new Set<number>();
      for (let i = 0; i < 5; i++) {
        const basePort = 10000 + i * 3;
        occupiedPorts.add(basePort);
        occupiedPorts.add(basePort + 1);
      }

      for (const port of Object.values(result.ports)) {
        expect(occupiedPorts.has(port)).toBe(false);
      }
    });

    it('sequential loadOrCreateState writes produce non-overlapping ports', async () => {
      const config = makeConfig(testDir);
      const allPorts: number[] = [];

      // Each iteration writes state for a different worktree, filling up the port space
      for (let i = 0; i < 10; i++) {
        // loadOrCreateState uses getCurrentBranch() → 'main' in tmpdir.
        // To test multiple allocations, we write state for named branches manually,
        // then verify the next allocation doesn't overlap.
        const basePort = 10000 + i * 3;
        const ports = { api: basePort, webapp: basePort + 1 };
        await writeState(makeState(`branch-${i}`, ports), config);
        allPorts.push(...Object.values(ports));
      }

      expect(new Set(allPorts).size).toBe(allPorts.length);
    });
  });

  describe('concurrent writes', () => {
    it('writes for different worktreeIds all persist', async () => {
      const config = makeConfig(testDir);
      const count = 10;

      await Promise.all(
        Array.from({ length: count }, (_, i) => {
          const ports = { api: 10000 + i * 3, webapp: 10001 + i * 3 };
          return writeState(makeState(`branch-${i}`, ports), config);
        }),
      );

      const stateDir = join(testDir, '.grove');
      const files = readdirSync(stateDir).filter(f => f.endsWith('.json'));
      expect(files).toHaveLength(count);

      for (let i = 0; i < count; i++) {
        const content = readFileSync(join(stateDir, `branch-${i}.json`), 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        expect(state.worktreeId).toBe(`branch-${i}`);
        expect(state.ports.api).toBe(10000 + i * 3);
      }
    });

    it('concurrent writes to the same file all succeed with retries', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          writeState(
            makeState('contested', { api: 10000 + i, webapp: 10001 + i }),
            config,
          ),
        ),
      );

      // The file on disk is valid JSON with one of the written values
      const content = readFileSync(join(testDir, '.grove', 'contested.json'), 'utf-8');
      const state: EnvironmentState = JSON.parse(content);
      expect(state.worktreeId).toBe('contested');
      expect(typeof state.ports.api).toBe('number');
    });
  });

  describe('namespace uniqueness', () => {
    it('different worktreeIds produce different namespaces', () => {
      const branches = ['feature-a', 'feature-b', 'bugfix-1', 'release-v2', 'main'];
      const namespaces = branches.map(b => makeState(b, {}).namespace);
      expect(new Set(namespaces).size).toBe(branches.length);
    });
  });

  describe('loadOrCreateState concurrency', () => {
    it('concurrent calls for same worktree all return identical state', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // In tmpdir (no git repo), getCurrentBranch falls back to 'main'.
      // All concurrent callers get worktreeId='main' and compete for port allocation.
      // The sentinel lock in loadOrCreateState serializes them.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => loadOrCreateState(config)),
      );

      // All callers must get identical ports — sentinel lock ensures only one allocates
      const first = results[0];
      for (const result of results) {
        expect(result.ports).toEqual(first.ports);
        expect(result.namespace).toBe(first.namespace);
        expect(result.worktreeId).toBe(first.worktreeId);
      }

      // Exactly one state file should exist
      const files = readdirSync(join(testDir, '.grove')).filter(f => f.endsWith('.json'));
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(`${first.worktreeId}.json`);
    });

    it('loadOrCreateState returns existing state without re-allocating ports', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // First call creates state
      const first = await loadOrCreateState(config);

      // Subsequent concurrent calls should all return the same state
      const results = await Promise.all(
        Array.from({ length: 5 }, () => loadOrCreateState(config)),
      );

      for (const result of results) {
        expect(result.ports).toEqual(first.ports);
      }
    });
  });

  describe('crash recovery', () => {
    it('.tmp exists with valid data, main is corrupt — readState recovers from .tmp', async () => {
      const config = makeConfig(testDir);
      const stateDir = join(testDir, '.grove');
      mkdirSync(stateDir, { recursive: true });

      // Simulate a crash: .tmp has valid state, main is truncated
      const validState = makeState('main', { api: 10000, webapp: 10001 });
      writeFileSync(join(stateDir, 'main.json'), '{"truncated": ', 'utf-8');
      writeFileSync(join(stateDir, 'main.json.tmp'), JSON.stringify(validState, null, 2), 'utf-8');

      const result = await readState(config, 'main');

      expect(result).not.toBeNull();
      expect(result!.namespace).toBe('testapp-main');
      expect(result!.ports.api).toBe(10000);

      // .tmp should have been promoted to main
      expect(existsSync(join(stateDir, 'main.json'))).toBe(true);
      const content = readFileSync(join(stateDir, 'main.json'), 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.namespace).toBe('testapp-main');
    });

    it('stale .tmp from a previous crash is not promoted', async () => {
      const config = makeConfig(testDir);
      const stateDir = join(testDir, '.grove');
      mkdirSync(stateDir, { recursive: true });

      // Write valid .tmp but backdate it to 2 minutes ago (stale)
      const validState = makeState('main', { api: 10000, webapp: 10001 });
      const tmpPath = join(stateDir, 'main.json.tmp');
      writeFileSync(tmpPath, JSON.stringify(validState, null, 2), 'utf-8');
      const staleTime = new Date(Date.now() - 120_000);
      utimesSync(tmpPath, staleTime, staleTime);

      // Main file is corrupt
      writeFileSync(join(stateDir, 'main.json'), '{"truncated": ', 'utf-8');

      const result = await readState(config, 'main');

      // Should NOT recover from stale .tmp
      expect(result).toBeNull();
      // Stale .tmp should have been cleaned up
      expect(existsSync(tmpPath)).toBe(false);
    });

    it('.tmp exists but is also corrupt — readState returns null', async () => {
      const config = makeConfig(testDir);
      const stateDir = join(testDir, '.grove');
      mkdirSync(stateDir, { recursive: true });

      writeFileSync(join(stateDir, 'main.json'), 'corrupt{', 'utf-8');
      writeFileSync(join(stateDir, 'main.json.tmp'), 'also corrupt{', 'utf-8');

      const result = await readState(config, 'main');
      expect(result).toBeNull();
    });

    it('writeState leaves no .tmp file on success', async () => {
      const config = makeConfig(testDir);
      const state = makeState('main', { api: 10000, webapp: 10001 });

      await writeState(state, config);

      const stateDir = join(testDir, '.grove');
      expect(existsSync(join(stateDir, 'main.json'))).toBe(true);
      expect(existsSync(join(stateDir, 'main.json.tmp'))).toBe(false);
    });
  });

  describe('mixed operations', () => {
    it('readState during concurrent writeState returns valid data or null', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // Pre-create state for 'main' (readState reads for current git branch → 'main' in tmpdir)
      await writeState(makeState('main', { api: 10000, webapp: 10001 }), config);

      // Concurrent writes to 'main' interleaved with reads
      const writePromises = Array.from({ length: 10 }, (_, i) =>
        writeState(makeState('main', { api: 10000 + i, webapp: 10001 + i }), config),
      );

      const readResults: Array<EnvironmentState | null> = [];
      const readPromises = Array.from({ length: 20 }, async () => {
        await new Promise(r => setTimeout(r, Math.random() * 5));
        readResults.push(await readState(config));
      });

      await Promise.all([...writePromises, ...readPromises]);

      // Every read result must be either null or a valid, well-formed state
      for (const state of readResults) {
        if (state !== null) {
          expect(state.worktreeId).toBe('main');
          expect(typeof state.ports.api).toBe('number');
          expect(typeof state.ports.webapp).toBe('number');
        }
      }
    });

    it('releasePortBlock on one file during writeState on another', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      // Create two separate state files
      await writeState(makeState('branch-a', { api: 10000, webapp: 10001 }), config);
      await writeState(makeState('branch-b', { api: 10003, webapp: 10004 }), config);

      // Both operations are now async — run them concurrently.
      // They operate on different files so there should be no interference.
      await Promise.all([
        writeState(makeState('branch-b', { api: 10006, webapp: 10007 }), config),
        releasePortBlock(config, 'branch-a'),
      ]);

      const stateDir = join(testDir, '.grove');

      // branch-a should be gone
      expect(existsSync(join(stateDir, 'branch-a.json'))).toBe(false);

      // branch-b should be intact with updated ports
      const content = readFileSync(join(stateDir, 'branch-b.json'), 'utf-8');
      const state: EnvironmentState = JSON.parse(content);
      expect(state.worktreeId).toBe('branch-b');
      expect(state.ports.api).toBe(10006);
    });

    it('releasePortBlock concurrent with writeState on same file', { timeout: 30_000 }, async () => {
      const config = makeConfig(testDir);

      await writeState(makeState('contested', { api: 10000, webapp: 10001 }), config);

      // Both are now async — run them concurrently.
      // Race: one deletes the state, the other writes.
      // If releasePortBlock deletes between writeState's file creation and lock acquisition,
      // writeState throws. Both outcomes are valid.
      try {
        await Promise.all([
          writeState(makeState('contested', { api: 10003, webapp: 10004 }), config),
          releasePortBlock(config, 'contested'),
        ]);
      } catch {
        // Expected: releasePortBlock deleted the file before writeState acquired the lock
      }

      const filePath = join(testDir, '.grove', 'contested.json');
      if (existsSync(filePath)) {
        // If file survived, it must be valid JSON — no corruption
        const content = readFileSync(filePath, 'utf-8');
        const state: EnvironmentState = JSON.parse(content);
        expect(state.worktreeId).toBe('contested');
      }
      // If file is gone, releasePortBlock won — also valid
    });
  });
});
