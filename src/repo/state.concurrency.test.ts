import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `grove-repo-concurrency-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { addRepo, readRegistry, removeRepo } = await import('./state.js');

describe('repo registry concurrency', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('sequential adds register all repos (baseline)', async () => {
    const count = 5;

    for (let i = 0; i < count; i++) {
      await addRepo(`repo-${i}`, `/home/user/repo-${i}`);
    }

    const registry = await readRegistry();
    expect(registry.repos).toHaveLength(count);
  });

  it('concurrent adds register all repos with retries', { timeout: 30_000 }, async () => {
    const count = 10;

    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        addRepo(`repo-${i}`, `/home/user/repo-${i}`),
      ),
    );

    // All repos are registered — no lost entries
    const registry = await readRegistry();
    expect(registry.repos).toHaveLength(count);

    // Every persisted entry is well-formed
    for (const repo of registry.repos) {
      expect(repo.id).toMatch(/^repo_/);
      expect(repo.name).toBeDefined();
      expect(repo.path).toBeDefined();
      expect(repo.addedAt).toBeDefined();
    }
  });

  it('concurrent adds with same path produce exactly one entry', { timeout: 30_000 }, async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        addRepo('same-repo', '/home/user/same-repo'),
      ),
    );

    const registry = await readRegistry();
    const matching = registry.repos.filter(r => r.path === '/home/user/same-repo');
    expect(matching).toHaveLength(1);
    expect(matching[0].name).toBe('same-repo');
  });

  it('registry entries have unique IDs after sequential then concurrent operations', { timeout: 30_000 }, async () => {
    // Sequential add creates a known-good baseline
    await addRepo('base-repo', '/home/user/base-repo');

    // Concurrent adds all succeed with retries
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        addRepo(`concurrent-${i}`, `/home/user/concurrent-${i}`),
      ),
    );

    const registry = await readRegistry();
    // All 6 repos present (1 sequential + 5 concurrent)
    expect(registry.repos).toHaveLength(6);

    const ids = registry.repos.map(r => r.id);
    // All persisted IDs must be unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('mixed operations', () => {
    it('removeRepo during concurrent addRepo preserves consistency', { timeout: 30_000 }, async () => {
      // Seed the registry
      await addRepo('keep-1', '/home/user/keep-1');
      await addRepo('keep-2', '/home/user/keep-2');
      await addRepo('remove-me', '/home/user/remove-me');

      // Concurrently: remove one repo while adding new ones
      await Promise.all([
        removeRepo('remove-me'),
        addRepo('new-1', '/home/user/new-1'),
        addRepo('new-2', '/home/user/new-2'),
      ]);

      const registry = await readRegistry();
      const names = registry.repos.map(r => r.name);

      // remove-me should be gone
      expect(names).not.toContain('remove-me');

      // originals + new ones should all be present (keep-1, keep-2, new-1, new-2)
      expect(names).toContain('keep-1');
      expect(names).toContain('keep-2');
      expect(names).toContain('new-1');
      expect(names).toContain('new-2');
      expect(registry.repos).toHaveLength(4);
    });

    it('readRegistry during concurrent addRepo returns valid data', { timeout: 30_000 }, async () => {
      // Seed
      await addRepo('seed', '/home/user/seed');

      // Concurrent reads interleaved with writes
      const readResults: Awaited<ReturnType<typeof readRegistry>>[] = [];
      const addPromises = Array.from({ length: 5 }, (_, i) =>
        addRepo(`concurrent-${i}`, `/home/user/concurrent-${i}`),
      );
      const readPromises = Array.from({ length: 10 }, async () => {
        await new Promise(r => setTimeout(r, Math.random() * 5));
        readResults.push(await readRegistry());
      });

      await Promise.all([...addPromises, ...readPromises]);

      // Every read should return a valid registry (possibly empty during
      // concurrent writes — readRegistryFromDisk catches partial-write parse
      // errors and returns emptyRegistry, which is correct behavior).
      for (const registry of readResults) {
        expect(registry.version).toBe(1);
        expect(Array.isArray(registry.repos)).toBe(true);

        // Every entry present must be well-formed
        for (const repo of registry.repos) {
          expect(repo.name).toBeDefined();
          expect(repo.path).toBeDefined();
        }
      }

      // Final state should have all 6 repos
      const final = await readRegistry();
      expect(final.repos).toHaveLength(6);
    });

    it('concurrent add and remove cycles leave registry consistent', { timeout: 30_000 }, async () => {
      // Add 10 repos sequentially
      for (let i = 0; i < 10; i++) {
        await addRepo(`repo-${i}`, `/home/user/repo-${i}`);
      }

      // Concurrently remove evens and add new ones
      await Promise.all([
        ...Array.from({ length: 5 }, (_, i) => removeRepo(`repo-${i * 2}`)),
        ...Array.from({ length: 5 }, (_, i) => addRepo(`new-${i}`, `/home/user/new-${i}`)),
      ]);

      const registry = await readRegistry();

      // 5 odd originals + 5 new = 10
      expect(registry.repos).toHaveLength(10);

      // Evens should be gone
      for (let i = 0; i < 5; i++) {
        expect(registry.repos.find(r => r.name === `repo-${i * 2}`)).toBeUndefined();
      }

      // Odds should remain
      for (let i = 0; i < 5; i++) {
        expect(registry.repos.find(r => r.name === `repo-${i * 2 + 1}`)).toBeDefined();
      }

      // New repos present
      for (let i = 0; i < 5; i++) {
        expect(registry.repos.find(r => r.name === `new-${i}`)).toBeDefined();
      }

      // All IDs unique
      const ids = registry.repos.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
