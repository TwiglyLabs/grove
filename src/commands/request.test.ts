import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

// Resolve symlinks (macOS /var -> /private/var) so paths match git's toplevel
const rawTestDir = join(tmpdir(), `grove-request-cmd-test-${process.pid}`);
mkdirSync(rawTestDir, { recursive: true });
const testDir = realpathSync(rawTestDir);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { requestCommand } = await import('./request.js');

function createGitRepo(name: string): string {
  const repoPath = join(testDir, name);
  mkdirSync(repoPath, { recursive: true });
  execSync('git init -b main', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'ignore' });
  // Create initial commit so HEAD exists
  writeFileSync(join(repoPath, '.gitkeep'), '');
  execSync('git add .gitkeep && git commit -m "init"', { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

function registerRepo(name: string, path: string): void {
  const registryDir = join(testDir, '.grove');
  mkdirSync(registryDir, { recursive: true });
  const registryPath = join(registryDir, 'repos.json');
  let registry = { version: 1, repos: [] as Array<{ name: string; path: string; addedAt: string }> };
  if (existsSync(registryPath)) {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
  }
  registry.repos.push({ name, path, addedAt: new Date().toISOString() });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

function readPlanFile(worktreePath: string, relativePath: string): string {
  return readFileSync(join(worktreePath, relativePath), 'utf-8');
}

describe('requestCommand', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let logged: string[];
  let originalCwd: string;

  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    delete process.env.GROVE_STATE_DIR;
    delete process.env.GROVE_WORKTREE_DIR;
    process.env.GROVE_WORKTREE_DIR = join(testDir, 'worktrees');
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
    logged = [];
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    originalCwd = process.cwd();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    process.exitCode = undefined;
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  // ── Usage output ──────────────────────────────────────────────────

  describe('usage', () => {
    it('prints usage when no args given', async () => {
      await requestCommand([]);
      expect(logged.some(l => l.includes('grove request'))).toBe(true);
    });

    it('prints usage on --help', async () => {
      await requestCommand(['--help']);
      expect(logged.some(l => l.includes('grove request'))).toBe(true);
    });
  });

  // ── Plan name validation ──────────────────────────────────────────

  describe('plan name validation', () => {
    it('rejects names with uppercase', async () => {
      await requestCommand(['target', 'MyPlan', '--body', 'content']);
      expect(logged.some(l => l.includes('kebab-case'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('rejects names with spaces', async () => {
      await requestCommand(['target', 'my plan', '--body', 'content']);
      expect(logged.some(l => l.includes('kebab-case'))).toBe(true);
    });

    it('rejects names with dots', async () => {
      await requestCommand(['target', 'my.plan', '--body', 'content']);
      expect(logged.some(l => l.includes('kebab-case'))).toBe(true);
    });

    it('rejects names with slashes', async () => {
      await requestCommand(['target', 'my/plan', '--body', 'content']);
      expect(logged.some(l => l.includes('kebab-case'))).toBe(true);
    });

    it('rejects names with leading hyphens', async () => {
      await requestCommand(['target', '-my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('kebab-case'))).toBe(true);
    });

    it('rejects names with trailing hyphens', async () => {
      await requestCommand(['target', 'my-plan-', '--body', 'content']);
      expect(logged.some(l => l.includes('kebab-case'))).toBe(true);
    });

    it('accepts valid kebab-case names', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      // Run from outside any repo
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      // Should NOT fail on name validation (may fail on other things if source === target, but not name)
      expect(logged.every(l => !l.includes('kebab-case'))).toBe(true);
    });

    it('accepts single-segment names', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'a', '--body', 'content']);
      expect(logged.every(l => !l.includes('kebab-case'))).toBe(true);
    });

    it('accepts names with numbers', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'fix-api-v2', '--body', 'content']);
      expect(logged.every(l => !l.includes('kebab-case'))).toBe(true);
    });
  });

  // ── Body input ────────────────────────────────────────────────────

  describe('body input', () => {
    it('fails when neither --body nor --body-file provided', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);

      await requestCommand(['target-repo', 'my-plan']);
      expect(logged.some(l => l.includes('--body') && l.includes('required'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails when both --body and --body-file provided', async () => {
      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--body-file', 'file.md']);
      expect(logged.some(l => l.includes('mutually exclusive'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails on empty --body', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);

      await requestCommand(['target-repo', 'my-plan', '--body', '']);
      expect(logged.some(l => l.includes('must not be empty'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails when --body-file path does not exist', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);

      await requestCommand(['target-repo', 'my-plan', '--body-file', '/nonexistent/file.md']);
      expect(logged.some(l => l.includes('does not exist') || l.includes('not found'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails when --body-file is empty', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      const emptyFile = join(testDir, 'empty.md');
      writeFileSync(emptyFile, '');

      await requestCommand(['target-repo', 'my-plan', '--body-file', emptyFile]);
      expect(logged.some(l => l.includes('must not be empty'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('reads content from --body-file', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      const bodyFile = join(testDir, 'request-body.md');
      writeFileSync(bodyFile, '## Context\n\nWe need a new API endpoint.');
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body-file', bodyFile, '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);

      // Verify the content made it into the plan file
      const planContent = readPlanFile(output.data.worktree, output.data.file);
      expect(planContent).toContain('We need a new API endpoint.');
    });
  });

  // ── Registry lookup ───────────────────────────────────────────────

  describe('registry lookup', () => {
    it('fails when target repo is not registered', async () => {
      await requestCommand(['nonexistent-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('not registered') || l.includes('grove repo add'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails when registered path does not exist on disk', async () => {
      registerRepo('missing-repo', '/nonexistent/path/to/repo');

      await requestCommand(['missing-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('does not exist') || l.includes('not found'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  });

  // ── Self-request detection ────────────────────────────────────────

  describe('self-request detection', () => {
    it('fails when target and source resolve to same repo', async () => {
      const repoPath = createGitRepo('self-repo');
      registerRepo('self-repo', repoPath);
      process.chdir(repoPath);

      await requestCommand(['self-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('Cannot request from a repo to itself'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  });

  // ── Source detection ──────────────────────────────────────────────

  describe('source detection', () => {
    it('detects source repo when cwd is inside a registered repo', async () => {
      const sourcePath = createGitRepo('source-repo');
      const targetPath = createGitRepo('target-repo');
      registerRepo('source-repo', sourcePath);
      registerRepo('target-repo', targetPath);
      process.chdir(sourcePath);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.source).toBe('source-repo');
    });

    it('detects source repo when cwd is inside a worktree of a registered repo', async () => {
      const sourcePath = createGitRepo('source-repo');
      const targetPath = createGitRepo('target-repo');
      registerRepo('source-repo', sourcePath);
      registerRepo('target-repo', targetPath);

      // Create a worktree from source-repo
      const worktreePath = join(testDir, 'worktrees', 'source-repo', 'feature');
      mkdirSync(join(testDir, 'worktrees', 'source-repo'), { recursive: true });
      execSync(`git worktree add -b feature-branch ${worktreePath}`, { cwd: sourcePath, stdio: 'ignore' });
      process.chdir(worktreePath);

      await requestCommand(['target-repo', 'another-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.source).toBe('source-repo');
    });

    it('sets source to null when cwd is not in a registered repo', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      // Create a non-registered git repo
      const unregistered = createGitRepo('unregistered');
      process.chdir(unregistered);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.source).toBeNull();
    });

    it('sets source to null when not in a git repo', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      const nonGitDir = join(testDir, 'no-git');
      mkdirSync(nonGitDir, { recursive: true });
      process.chdir(nonGitDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.source).toBeNull();
    });
  });

  // ── .trellis parsing ──────────────────────────────────────────────

  describe('.trellis parsing', () => {
    it('reads plans_dir from valid .trellis config', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      writeFileSync(join(targetPath, '.trellis'), 'project: target\nplans_dir: specs');
      mkdirSync(join(targetPath, 'specs'), { recursive: true });
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.file).toContain('specs/');
    });

    it('falls back to plans when .trellis is missing', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.file).toContain('plans/');
    });

    it('falls back to plans when .trellis is malformed', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      writeFileSync(join(targetPath, '.trellis'), 'garbage content {{{');
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.file).toContain('plans/');
    });

    it('falls back to plans when .trellis has no plans_dir key', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      writeFileSync(join(targetPath, '.trellis'), 'project: target');
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.file).toContain('plans/');
    });
  });

  // ── Plan directory resolution ─────────────────────────────────────

  describe('plan directory resolution', () => {
    it('uses plans_dir/active/ when that directory exists', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      mkdirSync(join(targetPath, 'plans', 'active'), { recursive: true });
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.file).toContain('plans/active/my-plan.md');
    });

    it('uses plans_dir/ when no active/ subdirectory', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.file).toBe('plans/my-plan.md');
    });

    it('creates directory structure when missing', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      // No plans/ dir exists in target
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      // Verify the file was actually created in the worktree
      const fullPath = join(output.data.worktree, output.data.file);
      expect(existsSync(fullPath)).toBe(true);
    });
  });

  // ── Duplicate detection ───────────────────────────────────────────

  describe('duplicate detection', () => {
    it('fails when plan file exists in plans_dir/', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      mkdirSync(join(targetPath, 'plans'), { recursive: true });
      writeFileSync(join(targetPath, 'plans', 'my-plan.md'), 'existing plan');
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('already exists'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails when plan file exists in plans_dir/active/', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      mkdirSync(join(targetPath, 'plans', 'active'), { recursive: true });
      writeFileSync(join(targetPath, 'plans', 'active', 'my-plan.md'), 'existing plan');
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('already exists'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('fails when request branch already exists in target repo', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      // Create the branch in the target repo
      execSync('git branch request/my-plan', { cwd: targetPath, stdio: 'ignore' });
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('already exists'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });

    it('error message includes conflicting path', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      mkdirSync(join(targetPath, 'plans'), { recursive: true });
      writeFileSync(join(targetPath, 'plans', 'my-plan.md'), 'existing plan');
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('plans/my-plan.md'))).toBe(true);
    });
  });

  // ── Detached HEAD ─────────────────────────────────────────────────

  describe('detached HEAD', () => {
    it('fails when target repo is on detached HEAD', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      // Detach HEAD
      const headSha = execSync('git rev-parse HEAD', { cwd: targetPath, encoding: 'utf-8' }).trim();
      execSync(`git checkout ${headSha}`, { cwd: targetPath, stdio: 'ignore' });
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      expect(logged.some(l => l.includes('detached HEAD'))).toBe(true);
      expect(process.exitCode).toBe(1);
    });
  });

  // ── Happy path ────────────────────────────────────────────────────

  describe('happy path', () => {
    it('creates worktree at expected path with correct branch', async () => {
      const sourcePath = createGitRepo('source-repo');
      const targetPath = createGitRepo('target-repo');
      registerRepo('source-repo', sourcePath);
      registerRepo('target-repo', targetPath);
      process.chdir(sourcePath);

      await requestCommand(['target-repo', 'fix-api-v2', '--body', '## Context\n\nNeed new endpoint.', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data.branch).toBe('request/fix-api-v2');
      expect(output.data.worktree).toContain('target-repo');
      expect(output.data.worktree).toContain('request');
      expect(output.data.worktree).toContain('fix-api-v2');
      expect(output.data.target).toBe('target-repo');
      expect(output.data.source).toBe('source-repo');
    });

    it('plan file has correct frontmatter and body', async () => {
      const sourcePath = createGitRepo('source-repo');
      const targetPath = createGitRepo('target-repo');
      registerRepo('source-repo', sourcePath);
      registerRepo('target-repo', targetPath);
      process.chdir(sourcePath);

      await requestCommand(['target-repo', 'fix-api-v2', '--body', '## Context\n\nNeed new endpoint.', '--description', 'New API endpoint for v2', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      const planContent = readPlanFile(output.data.worktree, output.data.file);

      expect(planContent).toContain('title: Fix Api V2');
      expect(planContent).toContain('status: draft');
      expect(planContent).toContain('source: source-repo');
      expect(planContent).toContain('description: "New API endpoint for v2"');
      expect(planContent).toContain('## Context');
      expect(planContent).toContain('Need new endpoint.');
    });

    it('commits the file with expected message including source', async () => {
      const sourcePath = createGitRepo('source-repo');
      const targetPath = createGitRepo('target-repo');
      registerRepo('source-repo', sourcePath);
      registerRepo('target-repo', targetPath);
      process.chdir(sourcePath);

      await requestCommand(['target-repo', 'fix-api-v2', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);

      const commitMsg = execSync('git log -1 --format=%s', {
        cwd: output.data.worktree,
        encoding: 'utf-8',
      }).trim();
      expect(commitMsg).toBe('Add request: fix-api-v2 (from source-repo)');
    });

    it('commit message omits source when null', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      const nonGitDir = join(testDir, 'no-git');
      mkdirSync(nonGitDir, { recursive: true });
      process.chdir(nonGitDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);

      const commitMsg = execSync('git log -1 --format=%s', {
        cwd: output.data.worktree,
        encoding: 'utf-8',
      }).trim();
      expect(commitMsg).toBe('Add request: my-plan');
    });

    it('text output includes worktree path, branch, and file path', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);
      const allOutput = logged.join('\n');
      expect(allOutput).toContain('request/my-plan');
      expect(allOutput).toContain('my-plan.md');
      expect(allOutput).toContain('worktree');
    });

    it('JSON mode returns structured result', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(true);
      expect(output.data).toHaveProperty('file');
      expect(output.data).toHaveProperty('worktree');
      expect(output.data).toHaveProperty('branch');
      expect(output.data).toHaveProperty('target');
    });

    it('with --description flag, includes description in frontmatter', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--description', 'A short desc', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      const planContent = readPlanFile(output.data.worktree, output.data.file);
      expect(planContent).toContain('description: "A short desc"');
    });

    it('source is null when description is omitted', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      const planContent = readPlanFile(output.data.worktree, output.data.file);
      expect(planContent).toContain('description: ""');
    });
  });

  // ── Title generation ──────────────────────────────────────────────

  describe('title generation', () => {
    it('converts my-plan to My Plan', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      const planContent = readPlanFile(output.data.worktree, output.data.file);
      expect(planContent).toContain('title: My Plan');
    });

    it('converts fix-api-v2 to Fix Api V2', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'fix-api-v2', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      const planContent = readPlanFile(output.data.worktree, output.data.file);
      expect(planContent).toContain('title: Fix Api V2');
    });

    it('converts single segment a to A', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'a', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      const planContent = readPlanFile(output.data.worktree, output.data.file);
      expect(planContent).toContain('title: A');
    });
  });

  // ── Workspace state ───────────────────────────────────────────────

  describe('workspace state', () => {
    it('writes state with correct id format', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'fix-api-v2', '--body', 'content', '--json']);

      const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-fix-api-v2.json');
      expect(existsSync(stateFile)).toBe(true);
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(state.id).toBe('target-repo-request-fix-api-v2');
    });

    it('writes state with active status', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);

      const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-my-plan.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(state.status).toBe('active');
    });

    it('writes state with correct branch', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);

      const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-my-plan.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(state.branch).toBe('request/my-plan');
    });

    it('writes state with target repo path as source', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);

      const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-my-plan.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(state.source).toBe(targetPath);
    });

    it('writes state with single parent repo entry', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);

      const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-my-plan.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(state.repos).toHaveLength(1);
      expect(state.repos[0].role).toBe('parent');
      expect(state.repos[0].name).toBe('target-repo');
      expect(state.repos[0].source).toBe(targetPath);
      expect(state.repos[0].parentBranch).toBe('main');
    });

    it('writes state with null sync', async () => {
      const targetPath = createGitRepo('target-repo');
      registerRepo('target-repo', targetPath);
      process.chdir(testDir);

      await requestCommand(['target-repo', 'my-plan', '--body', 'content']);

      const stateFile = join(testDir, '.grove', 'workspaces', 'target-repo-request-my-plan.json');
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      expect(state.sync).toBeNull();
    });
  });

  // ── JSON error output ─────────────────────────────────────────────

  describe('JSON error output', () => {
    it('returns JSON error for validation failures', async () => {
      await requestCommand(['target', 'MyPlan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(false);
      expect(output.error).toContain('kebab-case');
    });

    it('returns JSON error when target not registered', async () => {
      await requestCommand(['nonexistent', 'my-plan', '--body', 'content', '--json']);
      const output = JSON.parse(logged[logged.length - 1]);
      expect(output.ok).toBe(false);
    });
  });
});
