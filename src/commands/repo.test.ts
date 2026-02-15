import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Resolve symlinks (macOS /var -> /private/var) so paths match git's toplevel
const rawTestDir = join(tmpdir(), `grove-repo-cmd-test-${process.pid}`);
mkdirSync(rawTestDir, { recursive: true });
const testDir = realpathSync(rawTestDir);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { repoCommand } = await import('./repo.js');

function createGitRepo(name: string): string {
  const repoPath = join(testDir, name);
  mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function createNestedGitRepo(parent: string, child: string): string {
  const parentPath = createGitRepo(parent);
  const childPath = join(parentPath, child);
  mkdirSync(childPath, { recursive: true });
  execSync('git init', { cwd: childPath, stdio: 'ignore' });
  return childPath;
}

describe('repoCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let logged: string[];

  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    delete process.env.GROVE_STATE_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
    logged = [];
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('add', () => {
    it('registers a git repo from explicit path', async () => {
      const repoPath = createGitRepo('myrepo');
      await repoCommand(['add', repoPath]);

      // Verify it was added by listing
      await repoCommand(['list', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.repos).toHaveLength(1);
      expect(output.data.repos[0].name).toBe('myrepo');
    });

    it('returns JSON envelope on --json', async () => {
      const repoPath = createGitRepo('myrepo');
      await repoCommand(['add', repoPath, '--json']);

      const output = JSON.parse(logged[0]);
      expect(output).toEqual({
        ok: true,
        data: { name: 'myrepo', path: repoPath, alreadyRegistered: false },
      });
    });

    it('errors for non-git directory with --json', async () => {
      const nonGitPath = join(testDir, 'notgit');
      mkdirSync(nonGitPath, { recursive: true });
      await repoCommand(['add', nonGitPath, '--json']);

      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(false);
      expect(output.error).toContain('Not a git repository');
    });

    it('allows nested git repos', async () => {
      const childPath = createNestedGitRepo('parent', 'child');
      await repoCommand(['add', childPath, '--json']);

      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(true);
      expect(output.data.name).toBe('child');
      expect(output.data.path).toBe(childPath);
    });

    it('is a no-op for duplicate path', async () => {
      const repoPath = createGitRepo('myrepo');
      await repoCommand(['add', repoPath, '--json']);
      logged = [];

      await repoCommand(['add', repoPath, '--json']);
      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(true);
      expect(output.data.name).toBe('myrepo');
      expect(output.data.alreadyRegistered).toBe(true);
    });

    it('errors on name collision with different path', async () => {
      const repo1 = createGitRepo('myrepo');
      await repoCommand(['add', repo1, '--json']);

      // Create another repo with same basename in different parent
      const otherParent = join(testDir, 'other');
      mkdirSync(otherParent, { recursive: true });
      const repo2 = join(otherParent, 'myrepo');
      mkdirSync(repo2, { recursive: true });
      execSync('git init', { cwd: repo2, stdio: 'ignore' });

      logged = [];
      await repoCommand(['add', repo2, '--json']);
      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(false);
      expect(output.error).toContain('already registered for a different path');
    });
  });

  describe('remove', () => {
    it('removes an existing repo', async () => {
      const repoPath = createGitRepo('myrepo');
      await repoCommand(['add', repoPath]);
      logged = [];

      await repoCommand(['remove', 'myrepo', '--json']);
      const output = JSON.parse(logged[0]);
      expect(output).toEqual({ ok: true, data: { name: 'myrepo' } });
    });

    it('errors for non-existent repo', async () => {
      await repoCommand(['remove', 'nonexistent', '--json']);
      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(false);
      expect(output.error).toContain("No repo registered with name 'nonexistent'");
    });

    it('errors when no name provided', async () => {
      await repoCommand(['remove', '--json']);
      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(false);
      expect(output.error).toContain('Usage');
    });
  });

  describe('list', () => {
    it('shows info message when empty', async () => {
      await repoCommand(['list']);
      expect(logged.some(l => l.includes('No repos registered'))).toBe(true);
    });

    it('returns JSON with repo data', async () => {
      const repoPath = createGitRepo('myrepo');
      await repoCommand(['add', repoPath]);
      logged = [];

      await repoCommand(['list', '--json']);
      const output = JSON.parse(logged[0]);
      expect(output.ok).toBe(true);
      expect(output.data.repos).toHaveLength(1);
      expect(output.data.repos[0].name).toBe('myrepo');
      expect(output.data.repos[0].path).toBe(repoPath);
      expect(output.data.repos[0]).toHaveProperty('exists');
      expect(output.data.repos[0]).toHaveProperty('workspaces');
    });

    it('marks stale repos with exists: false', async () => {
      // Manually write a registry entry pointing to nonexistent path
      const registryPath = join(testDir, '.grove', 'repos.json');
      writeFileSync(registryPath, JSON.stringify({
        version: 1,
        repos: [{ name: 'gone', path: '/nonexistent/path', addedAt: '2026-02-14T10:00:00Z' }],
      }));

      await repoCommand(['list', '--json']);
      const output = JSON.parse(logged[0]);
      expect(output.data.repos[0].exists).toBe(false);
    });
  });

  describe('help', () => {
    it('shows help on --help', async () => {
      await repoCommand(['--help']);
      expect(logged.some(l => l.includes('grove repo'))).toBe(true);
    });

    it('shows help on unknown subcommand', async () => {
      await repoCommand(['unknown']);
      expect(logged.some(l => l.includes('grove repo'))).toBe(true);
    });
  });
});
