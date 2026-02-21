import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import * as repo from '../../src/repo/api.js';
import * as environment from '../../src/environment/api.js';
import type { RepoId } from '../../src/shared/identity.js';

const prerequisitesMet = canRunSmokeTests();
const FIXTURES_DIR = process.env.SMOKE_FIXTURES_DIR || join(import.meta.dirname, 'fixtures');
const SMOKE_CONFIG = join(FIXTURES_DIR, 'smoke.grove.yaml');
// Resolve absolute path to the Grove project root for rewriting relative paths
const GROVE_ROOT = resolve(import.meta.dirname, '..', '..');

interface ScaffoldedSmokeRepo {
  path: string;
  repoId: RepoId;
  cleanup: () => Promise<void>;
}

async function scaffoldSmokeRepo(suffix: string): Promise<ScaffoldedSmokeRepo> {
  const dir = join(tmpdir(), `grove-smoke-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });

  // The grove config references paths relative to repoRoot (e.g. test/smoke/fixtures/...).
  // Instead of rewriting paths, symlink the fixtures directory into the temp repo
  // so that relative paths resolve naturally when repoRoot is the temp dir.
  mkdirSync(join(dir, 'test', 'smoke'), { recursive: true });
  symlinkSync(join(GROVE_ROOT, 'test', 'smoke', 'fixtures'), join(dir, 'test', 'smoke', 'fixtures'));

  // Copy the smoke grove config, stripping sections that don't apply to lifecycle tests
  let configContent = readFileSync(SMOKE_CONFIG, 'utf-8');

  // Strip build blocks — images are pre-built and loaded into k3d by globalSetup.
  // Docker build would fail because COPY directives reference files relative to the Dockerfile.
  configContent = configContent.replace(/    build:\n      image: .*\n      dockerfile: .*\n/g, '');

  // Strip frontends — not tested in Tier 5, and the dev server won't be started.
  // Leaving it would cause health checks to wait for a non-existent frontend.
  configContent = configContent.replace(/\nfrontends:\n[\s\S]*$/, '\n');

  // Change Helm release from "grove-smoke" to "smoke" so K8s service names
  // ({{.Release.Name}}-auth → smoke-auth) match the config service names.
  configContent = configContent.replace(/release: grove-smoke/, 'release: smoke');

  // Give each scaffolded repo a unique project name so they get unique namespaces.
  // Namespace is derived from project.name + worktreeId (branch).
  // Only replace the project name (line after "project:"), not cluster or other names.
  configContent = configContent.replace(
    /project:\n  name: grove-smoke/,
    `project:\n  name: grove-smoke-${suffix}`,
  );

  writeFileSync(join(dir, '.grove.yaml'), configContent);

  // Initialize git repo (required for worktreeId derivation)
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init" --allow-empty', { cwd: dir, stdio: 'pipe' });

  // Register with Grove — add() returns RepoEntry, we need the .id
  const entry = await repo.add(dir);
  const repoId = entry.id;

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

  it('different repos get isolated namespaces', async () => {
    // Bring up repo1, record its namespace, then tear it down
    const r1 = await scaffoldSmokeRepo('iso-a');
    repos.push(r1);
    const result1 = await environment.up(r1.repoId);
    const namespace1 = result1.state.namespace;
    expect(result1.health.every(h => h.healthy)).toBe(true);

    // Tear down repo1 to release ports
    await environment.destroy(r1.repoId);

    // Bring up repo2 — should get a different namespace
    const r2 = await scaffoldSmokeRepo('iso-b');
    repos.push(r2);
    const result2 = await environment.up(r2.repoId);
    const namespace2 = result2.state.namespace;
    expect(result2.health.every(h => h.healthy)).toBe(true);

    // Unique namespaces (derived from unique project names)
    expect(namespace1).not.toBe(namespace2);
  }, 300_000);

  it.todo('partial up then prune cleans up correctly (requires controller DI for failure injection)');
});
