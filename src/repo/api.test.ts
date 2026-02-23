import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `grove-repo-api-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add, remove, get, list, findByPath, resolveRepoPath } = await import('./api.js');
const { RepoNotFoundError } = await import('../shared/errors.js');
const { isRepoId, asRepoId } = await import('../shared/identity.js');

describe('repo API', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('add', () => {
    it('registers a repo and returns entry with RepoId', async () => {
      const entry = await add('/tmp/test-repo');
      expect(entry.name).toBe('test-repo');
      expect(entry.path).toBe('/tmp/test-repo');
      expect(isRepoId(entry.id)).toBe(true);
      expect(entry.addedAt).toBeDefined();
    });

    it('returns existing entry when adding duplicate path', async () => {
      const first = await add('/tmp/dup-repo');
      const second = await add('/tmp/dup-repo');
      expect(second.id).toBe(first.id);
      expect(second.name).toBe(first.name);
    });
  });

  describe('get', () => {
    it('returns entry by RepoId', async () => {
      const added = await add('/tmp/get-repo');
      const found = await get(added.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(added.id);
      expect(found!.name).toBe('get-repo');
    });

    it('returns null for unknown RepoId', async () => {
      const { asRepoId } = await import('../shared/identity.js');
      const found = await get(asRepoId('repo_nonexistent1'));
      expect(found).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes a registered repo', async () => {
      const entry = await add('/tmp/remove-repo');
      await remove(entry.id);
      const found = await get(entry.id);
      expect(found).toBeNull();
    });

    it('throws RepoNotFoundError for unknown ID', async () => {
      const { asRepoId } = await import('../shared/identity.js');
      await expect(remove(asRepoId('repo_nonexistent1'))).rejects.toThrow(RepoNotFoundError);
    });
  });

  describe('list', () => {
    it('returns empty array when no repos registered', async () => {
      const entries = await list();
      expect(entries).toEqual([]);
    });

    it('returns entries sorted alphabetically with workspace counts', async () => {
      await add('/tmp/zulu');
      await add('/tmp/alpha');

      const entries = await list();
      expect(entries.map(e => e.name)).toEqual(['alpha', 'zulu']);
      expect(entries[0].workspaceCount).toBe(0);
      expect(entries[0].exists).toBe(false); // /tmp/zulu doesn't actually exist
    });

    it('returns entries with RepoId', async () => {
      await add('/tmp/id-check');
      const entries = await list();
      expect(isRepoId(entries[0].id)).toBe(true);
    });
  });

  describe('findByPath', () => {
    it('finds registered repo by path', async () => {
      const added = await add('/tmp/find-repo');
      const found = await findByPath('/tmp/find-repo');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(added.id);
      expect(found!.name).toBe('find-repo');
    });

    it('returns null for unregistered path', async () => {
      const found = await findByPath('/tmp/nonexistent');
      expect(found).toBeNull();
    });
  });

  describe('resolveRepoPath', () => {
    it('returns the path for a registered repo', async () => {
      const added = await add('/tmp/resolve-repo');
      const path = await resolveRepoPath(added.id);
      expect(path).toBe('/tmp/resolve-repo');
    });

    it('throws RepoNotFoundError for unknown RepoId', async () => {
      await expect(resolveRepoPath(asRepoId('repo_nonexistent1'))).rejects.toThrow(RepoNotFoundError);
    });
  });

  describe('list with workspace counts', () => {
    it('returns workspaceCount > 0 when workspace states exist', async () => {
      const repoPath = testDir; // Use testDir so it exists on disk
      await add(repoPath);

      // Write a workspace state file whose source matches the repo path
      const wsDir = join(testDir, '.grove', 'workspaces');
      writeFileSync(join(wsDir, 'test-ws.json'), JSON.stringify({
        version: 1,
        id: 'test-ws',
        status: 'active',
        branch: 'feature-x',
        createdAt: '2026-02-14T10:00:00Z',
        updatedAt: '2026-02-14T10:00:00Z',
        root: '/tmp/worktrees/feature-x',
        source: repoPath,
        repos: [{ name: 'test', role: 'parent', source: repoPath, worktree: '/tmp/wt', parentBranch: 'main' }],
        sync: null,
      }));

      const entries = await list();
      const entry = entries.find(e => e.path === repoPath);
      expect(entry).toBeDefined();
      expect(entry!.workspaceCount).toBe(1);
    });
  });
});
