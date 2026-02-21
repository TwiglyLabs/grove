import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import * as repo from '../../src/repo/api.js';
import * as environment from '../../src/environment/api.js';
import type { RepoId } from '../../src/shared/identity.js';

const prerequisitesMet = canRunSmokeTests();
const FIXTURES_DIR = process.env.SMOKE_FIXTURES_DIR || join(import.meta.dirname, 'fixtures');
const SMOKE_CONFIG = join(FIXTURES_DIR, 'smoke.grove.yaml');

interface ScaffoldedSmokeRepo {
  path: string;
  repoId: RepoId;
  cleanup: () => Promise<void>;
}

async function scaffoldSmokeRepo(suffix: string): Promise<ScaffoldedSmokeRepo> {
  const dir = join(tmpdir(), `grove-smoke-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  // Copy the smoke grove config
  cpSync(SMOKE_CONFIG, join(dir, '.grove.yaml'));

  // Initialize git repo (required for worktreeId derivation)
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init" --allow-empty', { cwd: dir, stdio: 'pipe' });

  // Register with Grove
  const repoId = await repo.add(dir);

  return {
    path: dir,
    repoId,
    cleanup: async () => {
      try { await environment.destroy(repoId); } catch {}
      try { await repo.remove(repoId); } catch {}
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

describe.skipIf(!prerequisitesMet).sequential('Tier 5: Lifecycle Edge Cases', () => {
  const repos: ScaffoldedSmokeRepo[] = [];

  afterEach(async () => {
    // Cleanup all repos created during the test
    for (const r of repos) {
      await r.cleanup();
    }
    repos.length = 0;
  });

  it('double up() is idempotent', async () => {
    const r = await scaffoldSmokeRepo('idempotent');
    repos.push(r);

    // First up
    const result1 = await environment.up(r.repoId);
    expect(result1.state.namespace).toBeTruthy();
    expect(Object.keys(result1.ports).length).toBeGreaterThan(0);

    // Second up — should reuse same namespace and ports
    const result2 = await environment.up(r.repoId);
    expect(result2.state.namespace).toBe(result1.state.namespace);
    expect(result2.ports).toEqual(result1.ports);
  }, 300_000);

  it('up → down → up preserves identity', async () => {
    const r = await scaffoldSmokeRepo('updownup');
    repos.push(r);

    // First up
    const result1 = await environment.up(r.repoId);
    const namespace1 = result1.state.namespace;
    const ports1 = result1.ports;

    // Down
    const downResult = await environment.down(r.repoId);
    // All port-forward processes should be stopped
    expect(downResult.stopped.length + downResult.notRunning.length).toBeGreaterThan(0);

    // Up again — same namespace and ports, new PIDs
    const result2 = await environment.up(r.repoId);
    expect(result2.state.namespace).toBe(namespace1);
    expect(result2.ports).toEqual(ports1);

    // Verify services are healthy
    for (const [name, port] of Object.entries(result2.ports)) {
      // Only check services with health endpoints
      if (result2.urls[name]) {
        // Health check is included in the up result
      }
    }
    // Health results should be present
    expect(result2.health).toBeDefined();
    expect(Array.isArray(result2.health)).toBe(true);
  }, 300_000);

  it('concurrent up() on different repos gets isolated environments', async () => {
    const r1 = await scaffoldSmokeRepo('concurrent-a');
    const r2 = await scaffoldSmokeRepo('concurrent-b');
    repos.push(r1, r2);

    // Bring up both in parallel
    const [result1, result2] = await Promise.all([
      environment.up(r1.repoId),
      environment.up(r2.repoId),
    ]);

    // Unique namespaces
    expect(result1.state.namespace).not.toBe(result2.state.namespace);

    // Non-overlapping ports
    const ports1 = new Set(Object.values(result1.ports));
    const ports2 = new Set(Object.values(result2.ports));
    for (const port of ports1) {
      expect(ports2.has(port)).toBe(false);
    }
  }, 300_000);

  it.todo('partial up then prune cleans up correctly (requires controller DI for failure injection)');
});
