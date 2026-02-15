import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { RepoRegistry } from './types.js';

const testDir = join(tmpdir(), `grove-repo-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { readRegistry, addRepo, removeRepo, getRegistryDir } = await import('./state.js');

describe('getRegistryDir', () => {
  afterEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
  });

  it('returns default path when GROVE_REGISTRY_DIR not set', () => {
    delete process.env.GROVE_REGISTRY_DIR;
    expect(getRegistryDir()).toBe(join(testDir, '.grove'));
  });

  it('returns GROVE_REGISTRY_DIR when set', () => {
    process.env.GROVE_REGISTRY_DIR = '/custom/registry';
    expect(getRegistryDir()).toBe('/custom/registry');
  });
});

describe('repo registry state', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('readRegistry', () => {
    it('returns empty registry when no file exists', async () => {
      const registry = await readRegistry();
      expect(registry).toEqual({ version: 1, repos: [] });
    });

    it('reads valid registry file', async () => {
      const data: RepoRegistry = {
        version: 1,
        repos: [
          { name: 'dotfiles', path: '/home/user/dotfiles', addedAt: '2026-02-14T10:00:00Z' },
        ],
      };
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify(data), 'utf-8');

      const registry = await readRegistry();
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0].name).toBe('dotfiles');
    });

    it('returns empty registry for invalid JSON', async () => {
      writeFileSync(join(testDir, '.grove', 'repos.json'), 'not json', 'utf-8');
      expect(await readRegistry()).toEqual({ version: 1, repos: [] });
    });

    it('returns empty registry for invalid schema', async () => {
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify({ version: 2 }), 'utf-8');
      expect(await readRegistry()).toEqual({ version: 1, repos: [] });
    });

    it('lazily migrates entries without IDs', async () => {
      const data = {
        version: 1,
        repos: [
          { name: 'repo-a', path: '/home/user/repo-a', addedAt: '2026-02-14T10:00:00Z' },
          { name: 'repo-b', path: '/home/user/repo-b', addedAt: '2026-02-14T10:01:00Z' },
        ],
      };
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify(data), 'utf-8');

      const registry = await readRegistry();

      // All entries should now have IDs
      expect(registry.repos[0].id).toBeDefined();
      expect(registry.repos[0].id).toMatch(/^repo_/);
      expect(registry.repos[1].id).toBeDefined();
      expect(registry.repos[1].id).toMatch(/^repo_/);

      // IDs should be different
      expect(registry.repos[0].id).not.toBe(registry.repos[1].id);

      // File on disk should be updated
      const onDisk = JSON.parse(readFileSync(join(testDir, '.grove', 'repos.json'), 'utf-8'));
      expect(onDisk.repos[0].id).toBe(registry.repos[0].id);
      expect(onDisk.repos[1].id).toBe(registry.repos[1].id);
    });

    it('does not re-generate IDs on subsequent reads', async () => {
      const data = {
        version: 1,
        repos: [
          { name: 'repo-a', path: '/home/user/repo-a', addedAt: '2026-02-14T10:00:00Z' },
        ],
      };
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify(data), 'utf-8');

      const first = await readRegistry();
      const secondId = first.repos[0].id;

      const second = await readRegistry();
      expect(second.repos[0].id).toBe(secondId);
    });

    it('preserves existing IDs during migration', async () => {
      const data = {
        version: 1,
        repos: [
          { id: 'repo_existingId12', name: 'has-id', path: '/a', addedAt: '2026-02-14T10:00:00Z' },
          { name: 'no-id', path: '/b', addedAt: '2026-02-14T10:01:00Z' },
        ],
      };
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify(data), 'utf-8');

      const registry = await readRegistry();
      expect(registry.repos[0].id).toBe('repo_existingId12');
      expect(registry.repos[1].id).toMatch(/^repo_/);
      expect(registry.repos[1].id).not.toBe('repo_existingId12');
    });
  });

  describe('addRepo', () => {
    it('adds a new repo to empty registry', async () => {
      const result = await addRepo('myrepo', '/home/user/myrepo');
      expect(result).toEqual({
        name: 'myrepo',
        path: '/home/user/myrepo',
        alreadyRegistered: false,
      });

      const registry = await readRegistry();
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0].name).toBe('myrepo');
      expect(registry.repos[0].path).toBe('/home/user/myrepo');
      expect(registry.repos[0].id).toMatch(/^repo_/);
    });

    it('adds multiple repos', async () => {
      await addRepo('repo-a', '/home/user/repo-a');
      await addRepo('repo-b', '/home/user/repo-b');

      const registry = await readRegistry();
      expect(registry.repos).toHaveLength(2);
    });

    it('returns alreadyRegistered for duplicate path', async () => {
      await addRepo('myrepo', '/home/user/myrepo');
      const result = await addRepo('myrepo', '/home/user/myrepo');
      expect(result.alreadyRegistered).toBe(true);

      const registry = await readRegistry();
      expect(registry.repos).toHaveLength(1);
    });

    it('throws on name collision with different path', async () => {
      await addRepo('myrepo', '/home/user/myrepo');
      await expect(addRepo('myrepo', '/other/path/myrepo')).rejects.toThrow(
        "Name 'myrepo' is already registered for a different path",
      );
    });
  });

  describe('removeRepo', () => {
    it('removes an existing repo', async () => {
      await addRepo('myrepo', '/home/user/myrepo');
      await removeRepo('myrepo');

      const registry = await readRegistry();
      expect(registry.repos).toHaveLength(0);
    });

    it('throws when removing non-existent repo', async () => {
      await expect(removeRepo('nonexistent')).rejects.toThrow(
        "No repo registered with name 'nonexistent'",
      );
    });

    it('removes correct repo when multiple exist', async () => {
      await addRepo('repo-a', '/home/user/repo-a');
      await addRepo('repo-b', '/home/user/repo-b');
      await removeRepo('repo-a');

      const registry = await readRegistry();
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0].name).toBe('repo-b');
    });
  });
});
