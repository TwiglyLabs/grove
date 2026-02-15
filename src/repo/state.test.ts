import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
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
    it('returns empty registry when no file exists', () => {
      const registry = readRegistry();
      expect(registry).toEqual({ version: 1, repos: [] });
    });

    it('reads valid registry file', () => {
      const data: RepoRegistry = {
        version: 1,
        repos: [
          { name: 'dotfiles', path: '/home/user/dotfiles', addedAt: '2026-02-14T10:00:00Z' },
        ],
      };
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify(data), 'utf-8');

      const registry = readRegistry();
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0].name).toBe('dotfiles');
    });

    it('returns empty registry for invalid JSON', () => {
      writeFileSync(join(testDir, '.grove', 'repos.json'), 'not json', 'utf-8');
      expect(readRegistry()).toEqual({ version: 1, repos: [] });
    });

    it('returns empty registry for invalid schema', () => {
      writeFileSync(join(testDir, '.grove', 'repos.json'), JSON.stringify({ version: 2 }), 'utf-8');
      expect(readRegistry()).toEqual({ version: 1, repos: [] });
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

      const registry = readRegistry();
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0].name).toBe('myrepo');
      expect(registry.repos[0].path).toBe('/home/user/myrepo');
    });

    it('adds multiple repos', async () => {
      await addRepo('repo-a', '/home/user/repo-a');
      await addRepo('repo-b', '/home/user/repo-b');

      const registry = readRegistry();
      expect(registry.repos).toHaveLength(2);
    });

    it('returns alreadyRegistered for duplicate path', async () => {
      await addRepo('myrepo', '/home/user/myrepo');
      const result = await addRepo('myrepo', '/home/user/myrepo');
      expect(result.alreadyRegistered).toBe(true);

      const registry = readRegistry();
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

      const registry = readRegistry();
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

      const registry = readRegistry();
      expect(registry.repos).toHaveLength(1);
      expect(registry.repos[0].name).toBe('repo-b');
    });
  });
});
