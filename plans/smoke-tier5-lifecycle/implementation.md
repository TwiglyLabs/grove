## Steps


## Testing
This plan IS the test. Run with `npm run test:smoke`.
## Done-when


## Design
### `test/smoke/tier5-lifecycle.smoke.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, writeFileSync, cpSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { canRunSmokeTests } from './helpers/prerequisites.js';
import { createNamespace, deleteNamespace, setContext } from './helpers/cluster.js';
import { stopAllForwards } from './helpers/port-forward.js';
import { loadConfig } from '../../src/config.js';
import { ensureEnvironment } from '../../src/environment/controller.js';
import { readState, loadOrCreateState } from '../../src/environment/state.js';
import { checkHealth } from '../../src/environment/health.js';

const prerequisitesMet = canRunSmokeTests();

const SMOKE_FIXTURE = join(import.meta.dirname, 'fixtures', 'smoke.grove.yaml');

interface TempRepo {
  path: string;
  cleanup: () => void;
}

function createTempRepo(suffix: string): TempRepo {
  const id = randomBytes(4).toString('hex');
  const name = `grove-smoke-t5-${suffix}-${id}`;
  const repoDir = join(tmpdir(), name);

  mkdirSync(repoDir, { recursive: true });
  cpSync(SMOKE_FIXTURE, join(repoDir, '.grove.yaml'));
  mkdirSync(join(repoDir, '.grove'), { recursive: true });

  // Initialize git repo
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync(`git checkout -b ${suffix}`, { cwd: repoDir, stdio: 'pipe' });
  writeFileSync(join(repoDir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

  return {
    path: repoDir,
    cleanup: () => {
      try { rmSync(repoDir, { recursive: true, force: true }); } catch {}
    },
  };
}

describe.skipIf(!prerequisitesMet).sequential('Tier 5: Lifecycle Edge Cases', () => {

  // --- Double up idempotency ---
  describe('Double up idempotency', () => {
    let repo: TempRepo;

    beforeAll(() => {
      repo = createTempRepo('double-up');
    });

    afterAll(() => {
      // Best-effort cleanup
      try {
        const config = loadConfig(repo.path);
        const state = readState(config);
        if (state) {
          // Kill processes
          for (const [, proc] of Object.entries(state.processes)) {
            try { process.kill(proc.pid, 'SIGTERM'); } catch {}
          }
          // Delete namespace
          try {
            execSync(`kubectl delete namespace ${state.namespace} --wait=false`, { stdio: 'pipe' });
          } catch {}
        }
      } catch {}
      repo.cleanup();
    });

    it('second up reuses namespace and ports from first up', async () => {
      const config = loadConfig(repo.path);

      // First up
      const state1 = await ensureEnvironment(config);
      const ns1 = state1.namespace;
      const ports1 = { ...state1.ports };

      // Second up (should be idempotent)
      const state2 = await ensureEnvironment(config);
      const ns2 = state2.namespace;
      const ports2 = { ...state2.ports };

      // Same namespace
      expect(ns2).toBe(ns1);

      // Same ports
      expect(ports2).toEqual(ports1);

      // No duplicate kubectl port-forward processes
      // (the second up should reuse or replace, not duplicate)
      const pfCount = Object.keys(state2.processes)
        .filter(k => k.startsWith('port-forward-')).length;
      const serviceCount = config.services.filter(s => s.portForward).length;
      expect(pfCount).toBe(serviceCount);
    });
  });

  // --- Up-down-up restart ---
  describe('Up-down-up restart', () => {
    let repo: TempRepo;

    beforeAll(() => {
      repo = createTempRepo('restart');
    });

    afterAll(() => {
      try {
        const config = loadConfig(repo.path);
        const state = readState(config);
        if (state) {
          for (const [, proc] of Object.entries(state.processes)) {
            try { process.kill(proc.pid, 'SIGTERM'); } catch {}
          }
          try {
            execSync(`kubectl delete namespace ${state.namespace} --wait=false`, { stdio: 'pipe' });
          } catch {}
        }
      } catch {}
      repo.cleanup();
    });

    it('up -> down -> up preserves namespace and ports', async () => {
      const config = loadConfig(repo.path);

      // Up
      const state1 = await ensureEnvironment(config);
      const ns = state1.namespace;
      const ports = { ...state1.ports };

      // Down (stop processes, keep state)
      for (const [, proc] of Object.entries(state1.processes)) {
        try { process.kill(proc.pid, 'SIGTERM'); } catch {}
      }
      // Simulate down by clearing process entries
      // (in production, environment.down() does this)

      // Wait for processes to die
      await new Promise(r => setTimeout(r, 2000));

      // Up again
      const state2 = await ensureEnvironment(config);

      // Should reuse namespace and ports
      expect(state2.namespace).toBe(ns);
      expect(state2.ports).toEqual(ports);

      // New processes should be running
      for (const [name, proc] of Object.entries(state2.processes)) {
        if (name.startsWith('port-forward-')) {
          // Verify new PID is actually running
          let running = false;
          try { process.kill(proc.pid, 0); running = true; } catch {}
          expect(running, `${name} should be running`).toBe(true);
        }
      }
    });
  });

  // --- Concurrent up on different branches ---
  describe('Concurrent up on different branches', () => {
    let repo1: TempRepo;
    let repo2: TempRepo;

    beforeAll(() => {
      repo1 = createTempRepo('branch-a');
      repo2 = createTempRepo('branch-b');
    });

    afterAll(() => {
      for (const repo of [repo1, repo2]) {
        try {
          const config = loadConfig(repo.path);
          const state = readState(config);
          if (state) {
            for (const [, proc] of Object.entries(state.processes)) {
              try { process.kill(proc.pid, 'SIGTERM'); } catch {}
            }
            try {
              execSync(`kubectl delete namespace ${state.namespace} --wait=false`, { stdio: 'pipe' });
            } catch {}
          }
        } catch {}
        repo.cleanup();
      }
    });

    it('two branches get isolated namespaces and non-overlapping ports', async () => {
      const config1 = loadConfig(repo1.path);
      const config2 = loadConfig(repo2.path);

      // Run up in parallel
      const [state1, state2] = await Promise.all([
        ensureEnvironment(config1),
        ensureEnvironment(config2),
      ]);

      // Different namespaces
      expect(state1.namespace).not.toBe(state2.namespace);

      // Non-overlapping ports
      const ports1 = new Set(Object.values(state1.ports));
      const ports2 = new Set(Object.values(state2.ports));
      for (const p of ports1) {
        expect(ports2.has(p), `Port ${p} should not overlap`).toBe(false);
      }
    });
  });

  // --- Partial up then prune ---
  describe('Partial up then prune', () => {
    // This test is harder to implement because we need to induce
    // a failure mid-way through ensureEnvironment(). One approach
    // is to use a config with a bad Helm chart path.
    it.todo('prune cleans up after partial up failure');
    // Future implementation:
    // 1. Use a config with a nonexistent Helm chart path
    // 2. Call ensureEnvironment() -- it will create namespace/state but fail at helm
    // 3. Call prune -- it should detect the orphaned namespace
    // 4. Verify namespace is deleted and state file is cleaned
  });
});
```

### Design notes

**Direct controller calls vs API layer:** This tier calls `ensureEnvironment()` and `loadConfig()` directly rather than going through the `environment.up()` API. The API layer requires RepoId resolution through the repo registry, which adds complexity without testing anything new. The controller is the right level of abstraction for lifecycle tests.

**Temp repos with distinct branches:** Each test creates a temp git repo on a unique branch. This exercises the worktree-based state isolation (`getWorktreeId()` derives namespace from branch name).

**Partial-up is a `todo`:** Inducing a controlled failure mid-orchestration is nontrivial without dependency injection in the controller. This is marked as a future test. The correct approach would be to add a test-only hook or use a deliberately broken Helm chart.

**Cleanup robustness:** Each `afterAll` does best-effort cleanup of processes, namespaces, and temp directories. Even if a test fails, cleanup should not leave orphaned resources.

## Files
| File | Action | Description |
|------|--------|-------------|
| `test/smoke/tier5-lifecycle.smoke.test.ts` | Create | All Tier 5 lifecycle edge case tests |
