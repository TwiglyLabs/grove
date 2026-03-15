import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process (execSync used in resolveCurrentRepo)
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

// Mock fs (realpathSync used in resolveCurrentRepo)
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    realpathSync: vi.fn((p: string) => p),
  };
});

// Mock repo API (findByPath/add used in resolveCurrentRepo)
vi.mock('./repo/api.js', () => ({
  findByPath: vi.fn(),
  add: vi.fn(),
}));

// Mock output (printError used in handleError)
vi.mock('./shared/output.js', () => ({
  printError: vi.fn(),
}));

// Mock all slice CLI modules so cli.ts imports don't pull in real dependencies
vi.mock('./environment/cli.js', () => ({
  upCommand: vi.fn(),
  downCommand: vi.fn(),
  destroyCommand: vi.fn(),
  statusCommand: vi.fn(),
  watchCommand: vi.fn(),
  pruneCommand: vi.fn(),
  reloadCommand: vi.fn(),
}));
vi.mock('./logs/cli.js', () => ({ logsCommand: vi.fn() }));
vi.mock('./testing/cli.js', () => ({ testCommand: vi.fn() }));
vi.mock('./shell/cli.js', () => ({ shellCommand: vi.fn() }));
vi.mock('./workspace/cli.js', () => ({ workspaceCommand: vi.fn() }));
vi.mock('./repo/cli.js', () => ({ repoCommand: vi.fn() }));

import { resolveCurrentRepo, program } from './cli.js';
import { execSync } from 'child_process';
import { realpathSync } from 'fs';
import * as repo from './repo/api.js';
import { isRepoId } from './shared/identity.js';

describe('resolveCurrentRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns RepoId for already-registered repo', async () => {
    vi.mocked(execSync).mockReturnValue('/home/user/myrepo\n');
    vi.mocked(realpathSync).mockReturnValue('/home/user/myrepo');
    vi.mocked(repo.findByPath).mockResolvedValue({
      id: 'repo_abc123def456' as any,
      name: 'myrepo',
      path: '/home/user/myrepo',
      addedAt: '2026-01-01T00:00:00Z',
    });

    const result = await resolveCurrentRepo();

    expect(execSync).toHaveBeenCalledWith('git rev-parse --show-toplevel', { encoding: 'utf-8' });
    expect(realpathSync).toHaveBeenCalledWith('/home/user/myrepo');
    expect(repo.findByPath).toHaveBeenCalledWith('/home/user/myrepo');
    expect(result).toBe('repo_abc123def456');
    expect(isRepoId(result)).toBe(true);
  });

  it('auto-registers unregistered repo and returns new RepoId', async () => {
    vi.mocked(execSync).mockReturnValue('/home/user/newrepo\n');
    vi.mocked(realpathSync).mockReturnValue('/home/user/newrepo');
    vi.mocked(repo.findByPath).mockResolvedValue(null);
    vi.mocked(repo.add).mockResolvedValue({
      id: 'repo_new123456789' as any,
      name: 'newrepo',
      path: '/home/user/newrepo',
      addedAt: '2026-01-01T00:00:00Z',
    });

    const result = await resolveCurrentRepo();

    expect(repo.findByPath).toHaveBeenCalledWith('/home/user/newrepo');
    expect(repo.add).toHaveBeenCalledWith('/home/user/newrepo');
    expect(result).toBe('repo_new123456789');
    expect(isRepoId(result)).toBe(true);
  });

  it('throws when not inside a git repository', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('fatal: not a git repository');
    });

    await expect(resolveCurrentRepo()).rejects.toThrow(
      'Not inside a git repository',
    );
    expect(repo.findByPath).not.toHaveBeenCalled();
  });

  it('resolves symlinks via realpathSync', async () => {
    vi.mocked(execSync).mockReturnValue('/tmp/symlink-repo\n');
    vi.mocked(realpathSync).mockReturnValue('/home/user/real-repo');
    vi.mocked(repo.findByPath).mockResolvedValue({
      id: 'repo_sym123456789' as any,
      name: 'real-repo',
      path: '/home/user/real-repo',
      addedAt: '2026-01-01T00:00:00Z',
    });

    const result = await resolveCurrentRepo();

    expect(realpathSync).toHaveBeenCalledWith('/tmp/symlink-repo');
    expect(repo.findByPath).toHaveBeenCalledWith('/home/user/real-repo');
    expect(result).toBe('repo_sym123456789');
  });

  it('trims trailing newline from git output', async () => {
    vi.mocked(execSync).mockReturnValue('/home/user/repo-with-newline\n');
    vi.mocked(realpathSync).mockReturnValue('/home/user/repo-with-newline');
    vi.mocked(repo.findByPath).mockResolvedValue({
      id: 'repo_trim12345678' as any,
      name: 'repo-with-newline',
      path: '/home/user/repo-with-newline',
      addedAt: '2026-01-01T00:00:00Z',
    });

    await resolveCurrentRepo();

    // realpathSync should receive the trimmed path, not with trailing newline
    expect(realpathSync).toHaveBeenCalledWith('/home/user/repo-with-newline');
  });
});

describe('program', () => {
  it('has correct name', () => {
    expect(program.name()).toBe('grove');
  });

  it('has a description', () => {
    expect(program.description()).toBe('Config-driven local Kubernetes development tool');
  });

  it('has version set', () => {
    expect(program.version()).toBe('0.1.0');
  });

  describe('command registration', () => {
    const commandNames = program.commands.map(cmd => cmd.name());

    it.each([
      'repo',
      'workspace',
      'up',
      'down',
      'destroy',
      'status',
      'watch',
      'prune',
      'logs',
      'test',
      'shell',
      'reload',
    ])('registers the "%s" command', (name) => {
      expect(commandNames).toContain(name);
    });

    it('registers exactly 12 commands', () => {
      expect(program.commands).toHaveLength(12);
    });
  });

  describe('command descriptions', () => {
    function getCommand(name: string) {
      return program.commands.find(cmd => cmd.name() === name)!;
    }

    it('up has description', () => {
      expect(getCommand('up').description()).toBeTruthy();
    });

    it('down has description', () => {
      expect(getCommand('down').description()).toBeTruthy();
    });

    it('logs requires a service argument', () => {
      // logs is defined as 'logs <service>'
      const logsCmd = getCommand('logs');
      const args = logsCmd.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('service');
      expect(args[0].required).toBe(true);
    });

    it('test requires a platform argument', () => {
      // test is defined as 'test <platform>'
      const testCmd = getCommand('test');
      const args = testCmd.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('platform');
      expect(args[0].required).toBe(true);
    });

    it('shell has an optional service argument', () => {
      // shell is defined as 'shell [service]'
      const shellCmd = getCommand('shell');
      const args = shellCmd.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('service');
      expect(args[0].required).toBe(false);
    });

    it('reload has an optional service argument', () => {
      // reload is defined as 'reload [service]'
      const reloadCmd = getCommand('reload');
      const args = reloadCmd.registeredArguments;
      expect(args).toHaveLength(1);
      expect(args[0].name()).toBe('service');
      expect(args[0].required).toBe(false);
    });
  });

  describe('command options', () => {
    function getCommand(name: string) {
      return program.commands.find(cmd => cmd.name() === name)!;
    }

    function optionNames(cmd: ReturnType<typeof getCommand>): string[] {
      return cmd.options.map(o => o.long ?? o.short ?? '');
    }

    it('up has --frontend option', () => {
      expect(optionNames(getCommand('up'))).toContain('--frontend');
    });

    it('up has --all option', () => {
      expect(optionNames(getCommand('up'))).toContain('--all');
    });

    it('up has --dev option', () => {
      expect(optionNames(getCommand('up'))).toContain('--dev');
    });

    it('up has --pull option', () => {
      expect(optionNames(getCommand('up'))).toContain('--pull');
    });

    it('logs has --pod option', () => {
      expect(optionNames(getCommand('logs'))).toContain('--pod');
    });
  });
});
