import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import type { RepoId } from '../shared/identity.js';
import { asRepoId } from '../shared/identity.js';
import { RepoNotFoundError, BranchExistsError } from '../shared/errors.js';

// Resolve symlinks (macOS /var -> /private/var) so paths match git's toplevel
const rawTestDir = join(tmpdir(), `grove-request-api-test-${process.pid}`);
mkdirSync(rawTestDir, { recursive: true });
const testDir = realpathSync(rawTestDir);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { createRequest } = await import('./api.js');

function createGitRepo(name: string): string {
  const repoPath = join(testDir, name);
  mkdirSync(repoPath, { recursive: true });
  execSync('git init -b main', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'ignore' });
  writeFileSync(join(repoPath, '.gitkeep'), '');
  execSync('git add .gitkeep && git commit -m "init"', { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function registerRepo(name: string, path: string, id?: string): RepoId {
  const registryDir = join(testDir, '.grove');
  mkdirSync(registryDir, { recursive: true });
  const registryPath = join(registryDir, 'repos.json');
  let registry = { version: 1, repos: [] as Array<{ id: string; name: string; path: string; addedAt: string }> };
  if (existsSync(registryPath)) {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
  }
  const repoId = id || `repo_${name}_${Date.now()}`;
  registry.repos.push({ id: repoId, name, path, addedAt: new Date().toISOString() });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  return asRepoId(repoId);
}

describe('createRequest', () => {
  let originalCwd: string;

  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    delete process.env.GROVE_STATE_DIR;
    delete process.env.GROVE_WORKTREE_DIR;
    process.env.GROVE_WORKTREE_DIR = join(testDir, 'worktrees');
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
    originalCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns RequestResult with correct fields', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(testDir);

    const result = await createRequest(targetId, 'my-plan', { body: '## Content\n\nHello.' });
    expect(result.file).toContain('my-plan.md');
    expect(result.branch).toBe('request/my-plan');
    expect(result.worktree).toContain('target-repo');
    expect(result.target).toBe('target-repo');
  });

  it('throws RepoNotFoundError for unknown RepoId', async () => {
    const fakeId = asRepoId('repo_nonexistent');
    await expect(
      createRequest(fakeId, 'my-plan', { body: 'content' }),
    ).rejects.toThrow(RepoNotFoundError);
  });

  it('throws for invalid plan name', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);

    await expect(
      createRequest(targetId, 'MyPlan', { body: 'content' }),
    ).rejects.toThrow('kebab-case');
  });

  it('throws for empty body', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);

    await expect(
      createRequest(targetId, 'my-plan', { body: '' }),
    ).rejects.toThrow('Body must not be empty');
  });

  it('throws for self-request', async () => {
    const repoPath = createGitRepo('self-repo');
    const repoId = registerRepo('self-repo', repoPath);
    process.chdir(repoPath);

    await expect(
      createRequest(repoId, 'my-plan', { body: 'content' }),
    ).rejects.toThrow('Cannot request from a repo to itself');
  });

  it('throws when plan file exists in plans_dir/', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    mkdirSync(join(targetPath, 'plans'), { recursive: true });
    writeFileSync(join(targetPath, 'plans', 'my-plan.md'), 'existing');
    process.chdir(testDir);

    await expect(
      createRequest(targetId, 'my-plan', { body: 'content' }),
    ).rejects.toThrow('already exists');
  });

  it('throws when plan file exists in plans_dir/active/', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    mkdirSync(join(targetPath, 'plans', 'active'), { recursive: true });
    writeFileSync(join(targetPath, 'plans', 'active', 'my-plan.md'), 'existing');
    process.chdir(testDir);

    await expect(
      createRequest(targetId, 'my-plan', { body: 'content' }),
    ).rejects.toThrow('already exists');
  });

  it('throws BranchExistsError when branch already exists', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    execSync('git branch request/my-plan', { cwd: targetPath, stdio: 'ignore' });
    process.chdir(testDir);

    await expect(
      createRequest(targetId, 'my-plan', { body: 'content' }),
    ).rejects.toThrow(BranchExistsError);
  });

  it('throws when target repo is on detached HEAD', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    const headSha = execSync('git rev-parse HEAD', { cwd: targetPath, encoding: 'utf-8' }).trim();
    execSync(`git checkout ${headSha}`, { cwd: targetPath, stdio: 'ignore' });
    process.chdir(testDir);

    await expect(
      createRequest(targetId, 'my-plan', { body: 'content' }),
    ).rejects.toThrow('detached HEAD');
  });

  it('uses explicit sourceRepo when provided', async () => {
    const sourcePath = createGitRepo('source-repo');
    const targetPath = createGitRepo('target-repo');
    const sourceId = registerRepo('source-repo', sourcePath);
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(testDir);

    const result = await createRequest(targetId, 'my-plan', {
      body: 'content',
      sourceRepo: sourceId,
    });
    expect(result.source).toBe('source-repo');
  });

  it('auto-detects source from cwd when sourceRepo omitted', async () => {
    const sourcePath = createGitRepo('source-repo');
    const targetPath = createGitRepo('target-repo');
    registerRepo('source-repo', sourcePath);
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(sourcePath);

    const result = await createRequest(targetId, 'my-plan', { body: 'content' });
    expect(result.source).toBe('source-repo');
  });

  it('includes description in frontmatter when provided', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(testDir);

    const result = await createRequest(targetId, 'my-plan', {
      body: 'content',
      description: 'A short desc',
    });
    const planContent = readFileSync(join(result.worktree, result.file), 'utf-8');
    expect(planContent).toContain('description: "A short desc"');
  });

  it('uses empty string description when omitted', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(testDir);

    const result = await createRequest(targetId, 'my-plan', { body: 'content' });
    const planContent = readFileSync(join(result.worktree, result.file), 'utf-8');
    expect(planContent).toContain('description: ""');
  });

  it('returns correct worktree path, branch name, and commit message', async () => {
    const sourcePath = createGitRepo('source-repo');
    const targetPath = createGitRepo('target-repo');
    registerRepo('source-repo', sourcePath);
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(sourcePath);

    const result = await createRequest(targetId, 'fix-api-v2', {
      body: '## Context\n\nNeed new endpoint.',
    });

    expect(result.worktree).toContain('fix-api-v2');
    expect(result.branch).toBe('request/fix-api-v2');

    const commitMsg = execSync('git log -1 --format=%s', {
      cwd: result.worktree,
      encoding: 'utf-8',
    }).trim();
    expect(commitMsg).toBe('Add request: fix-api-v2 (from source-repo)');
  });

  it('writes workspace state file', async () => {
    const targetPath = createGitRepo('target-repo');
    const targetId = registerRepo('target-repo', targetPath);
    process.chdir(testDir);

    await createRequest(targetId, 'my-plan', { body: 'content' });

    const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-my-plan.json');
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(state.id).toBe('target-repo-request-my-plan');
    expect(state.status).toBe('active');
    expect(state.branch).toBe('request/my-plan');
  });
});
