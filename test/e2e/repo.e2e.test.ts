import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { addRepo, removeRepo, readRegistry } from '../../src/repo/state.js';
import { listRepos } from '../../src/repo/list.js';
import { createWorkspace } from '../../src/workspace/create.js';
import { closeWorkspace } from '../../src/workspace/close.js';
import { deleteWorkspaceState } from '../../src/workspace/state.js';

// E2E tests use real git repos in a temp directory.
// GROVE_REGISTRY_DIR isolates repo registry from the user's home.
// GROVE_STATE_DIR isolates workspace state from the user's home.
// GROVE_WORKTREE_DIR isolates worktrees from the user's home.

const TEST_PREFIX = `grove-repo-e2e-${process.pid}`;
// Resolve symlinks (macOS /var -> /private/var) so paths match git's show-toplevel
const rawTempRoot = join(tmpdir(), TEST_PREFIX);
mkdirSync(rawTempRoot, { recursive: true });
const TEMP_ROOT = realpathSync(rawTempRoot);
const REGISTRY_DIR = join(TEMP_ROOT, 'registry');
const WORKTREE_DIR = join(TEMP_ROOT, 'worktrees');
const STATE_DIR = join(TEMP_ROOT, 'state');

const createdWorkspaceIds: string[] = [];

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function createTempRepo(name: string): string {
  const barePath = join(TEMP_ROOT, 'bare', name);
  mkdirSync(barePath, { recursive: true });
  git('init --bare', barePath);

  const repoPath = join(TEMP_ROOT, 'repos', name);
  git(`clone ${barePath} ${repoPath}`, TEMP_ROOT);
  git('config user.email "test@grove.dev"', repoPath);
  git('config user.name "Grove E2E"', repoPath);

  writeFileSync(join(repoPath, 'README.md'), `# ${name}\n`);
  git('add .', repoPath);
  git('commit -m "Initial commit"', repoPath);
  git('push origin main', repoPath);

  return repoPath;
}

function createGroupedRepos(parentName: string, childNames: string[]): {
  parent: string;
  children: Record<string, string>;
} {
  const parent = createTempRepo(parentName);

  const children: Record<string, string> = {};
  for (const childName of childNames) {
    const childBarePath = join(TEMP_ROOT, 'bare', `${parentName}-${childName}`);
    mkdirSync(childBarePath, { recursive: true });
    git('init --bare', childBarePath);

    const childPath = join(parent, childName);
    git(`clone ${childBarePath} ${childPath}`, parent);
    git('config user.email "test@grove.dev"', childPath);
    git('config user.name "Grove E2E"', childPath);
    writeFileSync(join(childPath, 'README.md'), `# ${childName}\n`);
    git('add .', childPath);
    git('commit -m "Initial commit"', childPath);
    git('push origin main', childPath);
    children[childName] = childPath;
  }

  const gitignore = childNames.map(n => `${n}/`).join('\n') + '\n';
  writeFileSync(join(parent, '.gitignore'), gitignore);

  const groveYaml = `workspace:\n  repos:\n${childNames.map(n => `    - path: ${n}`).join('\n')}\n`;
  writeFileSync(join(parent, '.grove.yaml'), groveYaml);

  git('add .', parent);
  git('commit -m "Add config and gitignore"', parent);

  return { parent, children };
}

function uniqueBranch(label: string): string {
  return `${TEST_PREFIX}-${label}-${Date.now()}`;
}

beforeAll(() => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  mkdirSync(REGISTRY_DIR, { recursive: true });
  mkdirSync(WORKTREE_DIR, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  process.env.GROVE_REGISTRY_DIR = REGISTRY_DIR;
  process.env.GROVE_WORKTREE_DIR = WORKTREE_DIR;
  process.env.GROVE_STATE_DIR = STATE_DIR;
});

afterEach(() => {
  for (const id of createdWorkspaceIds) {
    try {
      deleteWorkspaceState(id);
    } catch {
      // Already cleaned up
    }
  }
  createdWorkspaceIds.length = 0;
});

afterAll(() => {
  delete process.env.GROVE_REGISTRY_DIR;
  delete process.env.GROVE_WORKTREE_DIR;
  delete process.env.GROVE_STATE_DIR;
  try {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  } catch {
    // Best effort
  }
});

describe('repo registry e2e', () => {
  it('add → list → remove → list lifecycle', async () => {
    const repo = createTempRepo('lifecycle-repo');

    // Add
    const result = await addRepo('lifecycle-repo', repo);
    expect(result.name).toBe('lifecycle-repo');
    expect(result.path).toBe(repo);
    expect(result.alreadyRegistered).toBe(false);

    // List
    const list = await listRepos();
    expect(list.repos).toHaveLength(1);
    expect(list.repos[0].name).toBe('lifecycle-repo');
    expect(list.repos[0].path).toBe(repo);
    expect(list.repos[0].exists).toBe(true);
    expect(list.repos[0].workspaces).toEqual([]);

    // Remove
    await removeRepo('lifecycle-repo');

    // List after remove
    const listAfter = await listRepos();
    expect(listAfter.repos).toHaveLength(0);
  });

  it('duplicate add is a no-op', async () => {
    const repo = createTempRepo('dup-repo');

    const first = await addRepo('dup-repo', repo);
    expect(first.alreadyRegistered).toBe(false);

    const second = await addRepo('dup-repo', repo);
    expect(second.alreadyRegistered).toBe(true);

    // Only one entry in registry
    const registry = await readRegistry();
    expect(registry.repos).toHaveLength(1);

    // Cleanup
    await removeRepo('dup-repo');
  });

  it('name collision errors with different paths', async () => {
    const repo1 = createTempRepo('collision');
    // Create second repo with same basename in different parent
    const otherParent = join(TEMP_ROOT, 'repos', 'other');
    mkdirSync(otherParent, { recursive: true });
    const repo2Path = join(otherParent, 'collision');
    mkdirSync(repo2Path, { recursive: true });
    git('init', repo2Path);
    git('config user.email "test@grove.dev"', repo2Path);
    git('config user.name "Grove E2E"', repo2Path);
    writeFileSync(join(repo2Path, 'README.md'), '# collision2\n');
    git('add .', repo2Path);
    git('commit -m "Initial commit"', repo2Path);

    await addRepo('collision', repo1);

    await expect(addRepo('collision', repo2Path)).rejects.toThrow(
      "Name 'collision' is already registered for a different path",
    );

    // Cleanup
    await removeRepo('collision');
  });

  it('stale repo shows exists: false', async () => {
    const repo = createTempRepo('stale-repo');

    await addRepo('stale-repo', repo);

    // Verify exists: true initially
    let list = await listRepos();
    expect(list.repos[0].exists).toBe(true);

    // Delete the repo directory
    rmSync(repo, { recursive: true, force: true });

    // Verify exists: false
    list = await listRepos();
    expect(list.repos[0].exists).toBe(false);
    expect(list.repos[0].name).toBe('stale-repo');

    // Cleanup
    await removeRepo('stale-repo');
  });

  it('multiple repos sorted alphabetically', async () => {
    const repoZ = createTempRepo('zulu');
    const repoA = createTempRepo('alpha');
    const repoM = createTempRepo('mike');

    await addRepo('zulu', repoZ);
    await addRepo('alpha', repoA);
    await addRepo('mike', repoM);

    const list = await listRepos();
    expect(list.repos.map(r => r.name)).toEqual(['alpha', 'mike', 'zulu']);

    // Cleanup
    await removeRepo('zulu');
    await removeRepo('alpha');
    await removeRepo('mike');
  });

  it('repo list joins with workspace state', async () => {
    const repo = createTempRepo('joined-repo');
    const branch = uniqueBranch('joined');

    // Register the repo
    await addRepo('joined-repo', repo);

    // Create a workspace from it
    const ws = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(ws.id);

    // List repos — should show the workspace
    const list = await listRepos();
    const found = list.repos.find(r => r.name === 'joined-repo');
    expect(found).toBeDefined();
    expect(found!.workspaces).toHaveLength(1);
    expect(found!.workspaces[0].id).toBe(ws.id);
    expect(found!.workspaces[0].branch).toBe(branch);
    expect(found!.workspaces[0].status).toBe('active');
    expect(found!.workspaces[0].repoCount).toBe(1);

    // Close workspace and verify it disappears from repo list
    await closeWorkspace(branch, 'discard');
    createdWorkspaceIds.length = 0; // Already cleaned up

    const listAfter = await listRepos();
    const foundAfter = listAfter.repos.find(r => r.name === 'joined-repo');
    expect(foundAfter!.workspaces).toHaveLength(0);

    // Cleanup
    await removeRepo('joined-repo');
  });

  it('repo list joins grouped workspace with correct repoCount', async () => {
    const { parent } = createGroupedRepos('grouped-repo', ['public', 'cloud']);
    const branch = uniqueBranch('grouped');

    // Register the parent repo
    await addRepo('grouped-repo', parent);

    // Create a grouped workspace
    const ws = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(ws.id);

    // List repos — should show workspace with all 3 repos counted
    const list = await listRepos();
    const found = list.repos.find(r => r.name === 'grouped-repo');
    expect(found).toBeDefined();
    expect(found!.workspaces).toHaveLength(1);
    expect(found!.workspaces[0].repoCount).toBe(3);

    // Cleanup
    await closeWorkspace(branch, 'discard');
    createdWorkspaceIds.length = 0;
    await removeRepo('grouped-repo');
  });

  it('multiple workspaces for same repo appear in list', async () => {
    const repo = createTempRepo('multi-ws-repo');
    const branch1 = uniqueBranch('multi-ws-a');
    const branch2 = uniqueBranch('multi-ws-b');

    await addRepo('multi-ws-repo', repo);

    const ws1 = await createWorkspace(branch1, { from: repo });
    createdWorkspaceIds.push(ws1.id);

    const ws2 = await createWorkspace(branch2, { from: repo });
    createdWorkspaceIds.push(ws2.id);

    const list = await listRepos();
    const found = list.repos.find(r => r.name === 'multi-ws-repo');
    expect(found).toBeDefined();
    expect(found!.workspaces).toHaveLength(2);

    const wsBranches = found!.workspaces.map(w => w.branch).sort();
    expect(wsBranches).toEqual([branch1, branch2].sort());

    // Cleanup
    await closeWorkspace(branch1, 'discard');
    await closeWorkspace(branch2, 'discard');
    createdWorkspaceIds.length = 0;
    await removeRepo('multi-ws-repo');
  });
});
