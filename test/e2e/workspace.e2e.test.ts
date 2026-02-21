import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { createWorkspace } from '../../src/workspace/create.js';
import { listWorkspaces, getWorkspaceStatus } from '../../src/workspace/status.js';
import { syncWorkspace, ConflictError } from '../../src/workspace/sync.js';
import { closeWorkspace } from '../../src/workspace/close.js';
import { deleteWorkspaceState, readWorkspaceState, writeWorkspaceState, findWorkspaceByBranch } from '../../src/workspace/state.js';
import { create as apiCreate } from '../../src/workspace/api.js';
import { add as addRepo } from '../../src/repo/api.js';
import type { RepoId } from '../../src/shared/identity.js';

// E2E tests use real git repos in a temp directory.
// GROVE_WORKTREE_DIR isolates worktrees from the user's home.
// GROVE_STATE_DIR isolates state files from the user's home.
// GROVE_REGISTRY_DIR isolates repo registry from the user's home.

const TEST_PREFIX = `grove-e2e-${process.pid}`;
// Resolve symlinks (macOS /var -> /private/var) so paths match git's show-toplevel
const rawTempRoot = join(tmpdir(), TEST_PREFIX);
mkdirSync(rawTempRoot, { recursive: true });
const TEMP_ROOT = realpathSync(rawTempRoot);
const WORKTREE_DIR = join(TEMP_ROOT, 'worktrees');
const STATE_DIR = join(TEMP_ROOT, 'state');
const REGISTRY_DIR = join(TEMP_ROOT, 'registry');

// Track workspace IDs for cleanup
const createdWorkspaceIds: string[] = [];

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * Create a temp git repo with an initial commit and a local bare "origin" remote.
 * The bare repo acts as the upstream for fetch/merge operations.
 */
function createTempRepo(name: string): string {
  // Create a bare repo to serve as "origin"
  const barePath = join(TEMP_ROOT, 'bare', name);
  mkdirSync(barePath, { recursive: true });
  git('init --bare', barePath);

  // Clone from the bare repo to get a working copy with origin configured
  const repoPath = join(TEMP_ROOT, 'repos', name);
  git(`clone ${barePath} ${repoPath}`, TEMP_ROOT);
  git('config user.email "test@grove.dev"', repoPath);
  git('config user.name "Grove E2E"', repoPath);

  // Create initial commit and push to origin
  writeFileSync(join(repoPath, 'README.md'), `# ${name}\n`);
  git('add .', repoPath);
  git('commit -m "Initial commit"', repoPath);
  git('push origin main', repoPath);

  return repoPath;
}

/**
 * Create a parent repo with child repos nested inside, plus .grove.yaml.
 * Children are real git repos inside the parent (gitignored).
 */
function createGroupedRepos(parentName: string, childNames: string[]): {
  parent: string;
  children: Record<string, string>;
} {
  const parent = createTempRepo(parentName);

  const children: Record<string, string> = {};
  for (const childName of childNames) {
    // Create bare repo for the child
    const childBarePath = join(TEMP_ROOT, 'bare', `${parentName}-${childName}`);
    mkdirSync(childBarePath, { recursive: true });
    git('init --bare', childBarePath);

    // Clone into the child path inside the parent
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

  // Gitignore children in parent
  const gitignore = childNames.map(n => `${n}/`).join('\n') + '\n';
  writeFileSync(join(parent, '.gitignore'), gitignore);

  // Write .grove.yaml
  const groveYaml = `workspace:\n  repos:\n${childNames.map(n => `    - path: ${n}`).join('\n')}\n`;
  writeFileSync(join(parent, '.grove.yaml'), groveYaml);

  git('add .', parent);
  git('commit -m "Add config and gitignore"', parent);

  return { parent, children };
}

/**
 * Create independent sibling repos (not nested inside each other).
 * Used for testing API-sourced childRepos where repos live at arbitrary paths.
 */
function createSiblingRepos(parentName: string, childNames: string[]): {
  parent: string;
  children: Record<string, string>;
} {
  const parent = createTempRepo(parentName);
  const children: Record<string, string> = {};

  for (const childName of childNames) {
    children[childName] = createTempRepo(`${parentName}-${childName}`);
  }

  return { parent, children };
}

function uniqueBranch(label: string): string {
  return `${TEST_PREFIX}-${label}-${Date.now()}`;
}

beforeAll(() => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  mkdirSync(WORKTREE_DIR, { recursive: true });
  mkdirSync(STATE_DIR, { recursive: true });
  mkdirSync(REGISTRY_DIR, { recursive: true });
  process.env.GROVE_WORKTREE_DIR = WORKTREE_DIR;
  process.env.GROVE_STATE_DIR = STATE_DIR;
  process.env.GROVE_REGISTRY_DIR = REGISTRY_DIR;
});

afterEach(() => {
  // Clean up any workspace state files we created
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
  delete process.env.GROVE_WORKTREE_DIR;
  delete process.env.GROVE_STATE_DIR;
  delete process.env.GROVE_REGISTRY_DIR;
  // Clean up temp directory
  try {
    rmSync(TEMP_ROOT, { recursive: true, force: true });
  } catch {
    // Best effort
  }
});

describe('workspace e2e: simple', () => {
  it('create → list → status → close --discard lifecycle', async () => {
    const repo = createTempRepo('simple-proj');
    const branch = uniqueBranch('simple');

    // Create
    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    expect(result.id).toBe(`simple-proj-${branch}`);
    expect(result.repos).toEqual(['simple-proj']);
    expect(result.branch).toBe(branch);
    expect(existsSync(result.root)).toBe(true);

    // Verify worktree is on the right branch
    const worktreeBranch = git('branch --show-current', result.root);
    expect(worktreeBranch).toBe(branch);

    // List
    const list = listWorkspaces();
    const found = list.find(w => w.id === result.id);
    expect(found).toBeDefined();
    expect(found!.branch).toBe(branch);
    expect(found!.status).toBe('active');

    // Status
    const status = getWorkspaceStatus(branch);
    expect(status.id).toBe(result.id);
    expect(status.status).toBe('active');
    expect(status.repos).toHaveLength(1);
    expect(status.repos[0].dirty).toBe(0);
    expect(status.repos[0].commits).toBe(0);

    // Make a change and verify status reflects it
    writeFileSync(join(result.root, 'new-file.txt'), 'hello');
    const statusAfterChange = getWorkspaceStatus(branch);
    expect(statusAfterChange.repos[0].dirty).toBe(1);

    // Commit the change
    git('add .', result.root);
    git('commit -m "Add new file"', result.root);
    const statusAfterCommit = getWorkspaceStatus(branch);
    expect(statusAfterCommit.repos[0].dirty).toBe(0);
    expect(statusAfterCommit.repos[0].commits).toBe(1);

    // Discard
    await closeWorkspace(branch, 'discard');

    // Verify cleanup
    expect(existsSync(result.root)).toBe(false);
    const stateAfterClose = readWorkspaceState(result.id);
    expect(stateAfterClose).toBeNull();
  });

  it('create → sync (no upstream changes) → close --merge lifecycle', async () => {
    const repo = createTempRepo('merge-proj');
    const branch = uniqueBranch('merge');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Make a change in the worktree and commit
    writeFileSync(join(result.root, 'feature.txt'), 'new feature');
    git('add .', result.root);
    git('commit -m "Add feature"', result.root);

    // Sync (no upstream changes, should succeed immediately)
    const syncResult = await syncWorkspace(branch);
    expect(syncResult.synced).toEqual(['merge-proj']);

    // Merge-close
    await closeWorkspace(branch, 'merge');

    // Verify the feature commit was merged into the source repo's main branch
    const sourceLog = git('log --oneline -1', repo);
    expect(sourceLog).toContain('Add feature');

    // Verify cleanup
    expect(existsSync(result.root)).toBe(false);
    expect(readWorkspaceState(result.id)).toBeNull();
  });

  it('sync merges upstream changes', async () => {
    const repo = createTempRepo('sync-proj');
    const branch = uniqueBranch('sync');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Add a commit to the source repo's main branch and push to origin (upstream change)
    writeFileSync(join(repo, 'upstream.txt'), 'upstream change');
    git('add .', repo);
    git('commit -m "Upstream change"', repo);
    git('push origin main', repo);

    // Sync should merge the upstream change into the workspace
    await syncWorkspace(branch);

    // Verify the upstream file appears in the worktree
    expect(existsSync(join(result.root, 'upstream.txt'))).toBe(true);

    // Clean up
    await closeWorkspace(branch, 'discard');
  });

  it('preflight error when branch already exists', async () => {
    const repo = createTempRepo('preflight-proj');
    const branch = uniqueBranch('preflight');

    // Create the branch in the source repo first
    git(`branch ${branch}`, repo);

    await expect(createWorkspace(branch, { from: repo })).rejects.toThrow('already exists');
  });

  it('sync conflict → manual resolution → resume sync → success', async () => {
    const repo = createTempRepo('resolve-proj');
    const branch = uniqueBranch('resolve');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Create a conflict: modify same file on both sides
    writeFileSync(join(repo, 'README.md'), '# Upstream change\n');
    git('add .', repo);
    git('commit -m "Upstream"', repo);
    git('push origin main', repo);

    writeFileSync(join(result.root, 'README.md'), '# Worktree change\n');
    git('add .', result.root);
    git('commit -m "Worktree"', result.root);

    // First sync should throw ConflictError
    try {
      await syncWorkspace(branch);
      expect.unreachable('Should have thrown ConflictError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
    }

    // Manually resolve the conflict
    writeFileSync(join(result.root, 'README.md'), '# Resolved\n');
    git('add README.md', result.root);
    git('commit -m "Resolve conflict"', result.root);

    // Resume sync should succeed
    const syncResult = await syncWorkspace(branch);
    expect(syncResult.synced).toContain('resolve-proj');

    // Verify sync state was cleared
    const state = readWorkspaceState(result.id);
    expect(state).not.toBeNull();
    expect(state!.sync).toBeNull();

    // Verify the resolved content is in the worktree
    const content = readFileSync(join(result.root, 'README.md'), 'utf-8');
    expect(content).toBe('# Resolved\n');

    // Cleanup
    await closeWorkspace(branch, 'discard');
  });

  it('switch returns workspace root path', async () => {
    const repo = createTempRepo('switch-proj');
    const branch = uniqueBranch('switch');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Find by branch name
    const state = findWorkspaceByBranch(branch);
    expect(state).not.toBeNull();
    expect(state!.root).toBe(result.root);

    // Find by workspace ID
    const stateById = readWorkspaceState(result.id);
    expect(stateById).not.toBeNull();
    expect(stateById!.root).toBe(result.root);

    // Cleanup
    await closeWorkspace(branch, 'discard');
  });

  it('list flags missing workspaces', async () => {
    const repo = createTempRepo('missing-proj');
    const branch = uniqueBranch('missing');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Workspace root exists
    let list = listWorkspaces();
    let found = list.find(w => w.id === result.id);
    expect(found).toBeDefined();
    expect(found!.missing).toBe(false);

    // Remove the worktree directory manually to simulate stale state
    rmSync(result.root, { recursive: true, force: true });

    list = listWorkspaces();
    found = list.find(w => w.id === result.id);
    expect(found).toBeDefined();
    expect(found!.missing).toBe(true);

    // Discard cleans up the stale state
    await closeWorkspace(branch, 'discard');
  });
});

describe('workspace e2e: grouped', () => {
  it('create → verify layout → close --discard', async () => {
    const { parent, children } = createGroupedRepos('grouped-proj', ['public', 'cloud']);
    const branch = uniqueBranch('grouped');

    const result = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(result.id);

    expect(result.repos).toEqual(['grouped-proj', 'public', 'cloud']);

    // Verify parent worktree exists and is on correct branch
    expect(existsSync(result.root)).toBe(true);
    expect(git('branch --show-current', result.root)).toBe(branch);

    // Verify children are nested inside parent worktree
    const publicWorktree = join(result.root, 'public');
    const cloudWorktree = join(result.root, 'cloud');
    expect(existsSync(publicWorktree)).toBe(true);
    expect(existsSync(cloudWorktree)).toBe(true);
    expect(git('branch --show-current', publicWorktree)).toBe(branch);
    expect(git('branch --show-current', cloudWorktree)).toBe(branch);

    // Status shows all repos
    const status = getWorkspaceStatus(branch);
    expect(status.repos).toHaveLength(3);
    expect(status.repos.map(r => r.name)).toEqual(['grouped-proj', 'public', 'cloud']);

    // Discard
    await closeWorkspace(branch, 'discard');
    expect(existsSync(result.root)).toBe(false);
  });

  it('create → commit in child → sync → close --merge', async () => {
    const { parent, children } = createGroupedRepos('gmerge-proj', ['public', 'cloud']);
    const branch = uniqueBranch('gmerge');

    const result = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(result.id);

    const publicWorktree = join(result.root, 'public');

    // Make a change in the child repo's worktree
    writeFileSync(join(publicWorktree, 'child-feature.txt'), 'child work');
    git('add .', publicWorktree);
    git('commit -m "Child feature"', publicWorktree);

    // Also commit in parent
    writeFileSync(join(result.root, 'parent-feature.txt'), 'parent work');
    git('add .', result.root);
    git('commit -m "Parent feature"', result.root);

    // Sync (no upstream changes)
    await syncWorkspace(branch);

    // Close --merge
    await closeWorkspace(branch, 'merge');

    // Verify merges landed in source repos
    const parentLog = git('log --oneline -1', parent);
    expect(parentLog).toContain('Parent feature');

    const publicLog = git('log --oneline -1', children['public']);
    expect(publicLog).toContain('Child feature');

    // Cleanup verified
    expect(existsSync(result.root)).toBe(false);
  });

  it('preflight error when repos on different branches', async () => {
    const { parent, children } = createGroupedRepos('diffbranch-proj', ['public', 'cloud']);

    // Put 'public' on a different branch
    git('checkout -b develop', children['public']);

    const branch = uniqueBranch('diffbranch');

    await expect(createWorkspace(branch, { from: parent })).rejects.toThrow(
      'Repos are on different branches',
    );
  });

  it('close --merge blocked by dirty files', async () => {
    const { parent } = createGroupedRepos('dirty-proj', ['public']);
    const branch = uniqueBranch('dirty');

    const result = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(result.id);

    // Leave an uncommitted file
    writeFileSync(join(result.root, 'uncommitted.txt'), 'dirty');

    await expect(closeWorkspace(branch, 'merge')).rejects.toThrow('Uncommitted changes');

    // Clean up with discard
    await closeWorkspace(branch, 'discard');
  });

  it('sync with conflict stops and reports', async () => {
    const { parent } = createGroupedRepos('conflict-proj', ['public']);
    const branch = uniqueBranch('conflict');

    const result = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(result.id);

    // Create a conflict: modify same file in source (push to origin) and worktree
    writeFileSync(join(parent, 'README.md'), '# Source version\n');
    git('add .', parent);
    git('commit -m "Source change"', parent);
    git('push origin main', parent);

    writeFileSync(join(result.root, 'README.md'), '# Worktree version\n');
    git('add .', result.root);
    git('commit -m "Worktree change"', result.root);

    // Sync should throw ConflictError
    try {
      await syncWorkspace(branch);
      expect.unreachable('Should have thrown ConflictError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const ce = error as InstanceType<typeof ConflictError>;
      expect(ce.conflicted).toBe('conflict-proj');
      expect(ce.files.length).toBeGreaterThan(0);
    }

    // Verify state shows conflict
    const state = readWorkspaceState(result.id);
    expect(state).not.toBeNull();
    expect(state!.sync).not.toBeNull();
    expect(state!.sync!.repos['conflict-proj']).toBe('conflicted');

    // Clean up with discard
    await closeWorkspace(branch, 'discard');
  });

  it('discard succeeds even with active merge conflict', async () => {
    const { parent } = createGroupedRepos('discard-conflict-proj', ['public']);
    const branch = uniqueBranch('discard-conflict');

    const result = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(result.id);

    // Create a conflict (push to origin so fetch picks it up)
    writeFileSync(join(parent, 'README.md'), '# Source\n');
    git('add .', parent);
    git('commit -m "Source"', parent);
    git('push origin main', parent);

    writeFileSync(join(result.root, 'README.md'), '# Worktree\n');
    git('add .', result.root);
    git('commit -m "Worktree"', result.root);

    // Trigger the conflict via sync
    try {
      await syncWorkspace(branch);
    } catch {
      // Expected
    }

    // Discard should succeed even with merge in progress
    await closeWorkspace(branch, 'discard');
    expect(existsSync(result.root)).toBe(false);
  });

  it('sync detects conflict in child repo', async () => {
    const { parent, children } = createGroupedRepos('child-conflict-proj', ['public', 'cloud']);
    const branch = uniqueBranch('child-conflict');

    const result = await createWorkspace(branch, { from: parent });
    createdWorkspaceIds.push(result.id);

    const publicWorktree = join(result.root, 'public');

    // Create conflict in child repo: push upstream change and make local change
    const publicBare = join(TEMP_ROOT, 'bare', 'child-conflict-proj-public');
    // Clone bare to a temp working copy to push an upstream change
    const tempClone = join(TEMP_ROOT, 'temp-clone-public');
    git(`clone ${publicBare} ${tempClone}`, TEMP_ROOT);
    git('config user.email "test@grove.dev"', tempClone);
    git('config user.name "Grove E2E"', tempClone);
    writeFileSync(join(tempClone, 'README.md'), '# Upstream public\n');
    git('add .', tempClone);
    git('commit -m "Upstream public"', tempClone);
    git('push origin main', tempClone);

    // Make conflicting change in child worktree
    writeFileSync(join(publicWorktree, 'README.md'), '# Worktree public\n');
    git('add .', publicWorktree);
    git('commit -m "Worktree public"', publicWorktree);

    // Sync should detect conflict in child repo (parent syncs fine)
    try {
      await syncWorkspace(branch);
      expect.unreachable('Should have thrown ConflictError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      const ce = error as InstanceType<typeof ConflictError>;
      expect(ce.conflicted).toBe('public');
      expect(ce.files.length).toBeGreaterThan(0);
      // Parent should have synced successfully
      expect(ce.resolved).toContain('child-conflict-proj');
    }

    // Verify state shows child as conflicted and parent as synced
    const state = readWorkspaceState(result.id);
    expect(state!.sync!.repos['child-conflict-proj']).toBe('synced');
    expect(state!.sync!.repos['public']).toBe('conflicted');

    // Cleanup
    await closeWorkspace(branch, 'discard');

    // Also clean up temp clone
    rmSync(tempClone, { recursive: true, force: true });
  });
});

describe('workspace e2e: close-merge-recovery', () => {
  it('close --merge with diverged upstream auto-syncs and succeeds', async () => {
    const repo = createTempRepo('autosync-proj');
    const branch = uniqueBranch('autosync');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Make a commit in the workspace
    writeFileSync(join(result.root, 'feature.txt'), 'workspace work');
    git('add .', result.root);
    git('commit -m "Workspace feature"', result.root);

    // Advance main past the workspace (push to origin so sync can fetch it)
    writeFileSync(join(repo, 'upstream.txt'), 'upstream work');
    git('add .', repo);
    git('commit -m "Upstream advance"', repo);
    git('push origin main', repo);

    // close --merge should detect divergence, auto-sync, and succeed
    await closeWorkspace(branch, 'merge');

    // Verify the workspace commit was merged into main
    const log = git('log --oneline -3', repo);
    expect(log).toContain('Workspace feature');

    // Verify cleanup
    expect(existsSync(result.root)).toBe(false);
    expect(readWorkspaceState(result.id)).toBeNull();
  });

  it('sync recovers a failed workspace', async () => {
    const repo = createTempRepo('failed-proj');
    const branch = uniqueBranch('failed');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Simulate a failed state (e.g. safety net fired during a previous close attempt)
    const state = readWorkspaceState(result.id);
    expect(state).not.toBeNull();
    state!.status = 'failed';
    state!.updatedAt = new Date().toISOString();
    await writeWorkspaceState(state!);

    // Verify state is failed
    const failedState = readWorkspaceState(result.id);
    expect(failedState!.status).toBe('failed');

    // Sync should accept the failed workspace, reset to active, and sync
    const syncResult = await syncWorkspace(branch);
    expect(syncResult.synced).toContain('failed-proj');

    // Verify state is now active with sync cleared
    const recoveredState = readWorkspaceState(result.id);
    expect(recoveredState!.status).toBe('active');
    expect(recoveredState!.sync).toBeNull();

    // Cleanup
    await closeWorkspace(branch, 'discard');
  });

  it('close --merge conflict → resolve → sync → close --merge succeeds', async () => {
    const repo = createTempRepo('recovery-proj');
    const branch = uniqueBranch('recovery');

    const result = await createWorkspace(branch, { from: repo });
    createdWorkspaceIds.push(result.id);

    // Commit a change in the workspace that touches README.md
    writeFileSync(join(result.root, 'README.md'), '# Workspace version\n');
    git('add .', result.root);
    git('commit -m "Workspace README"', result.root);

    // Create a conflicting upstream change on the same file
    writeFileSync(join(repo, 'README.md'), '# Upstream version\n');
    git('add .', repo);
    git('commit -m "Upstream README"', repo);
    git('push origin main', repo);

    // close --merge should detect divergence, attempt auto-sync, and fail with conflict error
    try {
      await closeWorkspace(branch, 'merge');
      expect.unreachable('Should have thrown due to merge conflicts');
    } catch (error) {
      expect((error as Error).message).toContain('Cannot merge: conflicts');
    }

    // Workspace should still be active (not failed, not closing)
    const stateAfterFail = readWorkspaceState(result.id);
    expect(stateAfterFail!.status).toBe('active');

    // Resolve the conflict in the worktree
    writeFileSync(join(result.root, 'README.md'), '# Resolved\n');
    git('add README.md', result.root);
    git('commit -m "Resolve conflict"', result.root);

    // Complete the sync
    const syncResult = await syncWorkspace(branch);
    expect(syncResult.synced).toContain('recovery-proj');

    // Now close --merge should succeed
    await closeWorkspace(branch, 'merge');

    // Verify the resolved content landed in the source repo
    const content = readFileSync(join(repo, 'README.md'), 'utf-8');
    expect(content).toBe('# Resolved\n');

    // Verify cleanup
    expect(existsSync(result.root)).toBe(false);
    expect(readWorkspaceState(result.id)).toBeNull();
  });
});

describe('workspace e2e: API-sourced repos (childRepos)', () => {
  it('create with childRepos → worktrees for parent + children at independent paths', async () => {
    const { parent, children } = createSiblingRepos('api-proj', ['api-svc', 'web-app']);
    const branch = uniqueBranch('api-child');

    const result = await createWorkspace(branch, {
      from: parent,
      childRepos: [
        { path: children['api-svc'], name: 'api-svc' },
        { path: children['web-app'], name: 'web-app' },
      ],
    });
    createdWorkspaceIds.push(result.id);

    expect(result.repos).toEqual(['api-proj', 'api-svc', 'web-app']);

    // Verify parent worktree
    expect(existsSync(result.root)).toBe(true);
    expect(git('branch --show-current', result.root)).toBe(branch);

    // Verify child worktrees are nested inside parent worktree root
    const apiWorktree = join(result.root, 'api-svc');
    const webWorktree = join(result.root, 'web-app');
    expect(existsSync(apiWorktree)).toBe(true);
    expect(existsSync(webWorktree)).toBe(true);
    expect(git('branch --show-current', apiWorktree)).toBe(branch);
    expect(git('branch --show-current', webWorktree)).toBe(branch);

    // State has all 3 repos with correct roles
    const state = readWorkspaceState(result.id);
    expect(state).not.toBeNull();
    expect(state!.repos).toHaveLength(3);
    expect(state!.repos[0]).toMatchObject({ name: 'api-proj', role: 'parent' });
    expect(state!.repos[1]).toMatchObject({ name: 'api-svc', role: 'child' });
    expect(state!.repos[2]).toMatchObject({ name: 'web-app', role: 'child' });

    // Status shows all repos
    const status = getWorkspaceStatus(branch);
    expect(status.repos).toHaveLength(3);

    // Discard cleans up all worktrees
    await closeWorkspace(branch, 'discard');
    expect(existsSync(result.root)).toBe(false);
    expect(existsSync(apiWorktree)).toBe(false);
    expect(existsSync(webWorktree)).toBe(false);
  });

  it('childRepos overrides config repos', async () => {
    // Create a grouped repo with config repos
    const { parent } = createGroupedRepos('override-proj', ['config-child']);
    // Create a separate repo to use as API-sourced child
    const apiChild = createTempRepo('override-proj-api-child');

    const branch = uniqueBranch('override');

    // Pass childRepos — should use API child, not config child
    const result = await createWorkspace(branch, {
      from: parent,
      childRepos: [
        { path: apiChild, name: 'api-child' },
      ],
    });
    createdWorkspaceIds.push(result.id);

    // Should have parent + api-child, NOT config-child
    expect(result.repos).toEqual(['override-proj', 'api-child']);
    expect(result.repos).not.toContain('config-child');

    // Verify the API child worktree exists
    const apiChildWorktree = join(result.root, 'api-child');
    expect(existsSync(apiChildWorktree)).toBe(true);
    expect(git('branch --show-current', apiChildWorktree)).toBe(branch);

    // Config child worktree should NOT exist
    expect(existsSync(join(result.root, 'config-child'))).toBe(false);

    await closeWorkspace(branch, 'discard');
  });

  it('childRepos: commit in child → close --merge → changes land in source', async () => {
    const { parent, children } = createSiblingRepos('merge-api-proj', ['service']);
    const branch = uniqueBranch('merge-api');

    const result = await createWorkspace(branch, {
      from: parent,
      childRepos: [{ path: children['service'], name: 'service' }],
    });
    createdWorkspaceIds.push(result.id);

    const serviceWorktree = join(result.root, 'service');

    // Gitignore the child worktree directory in the parent
    // (same as grouped repos do — child dirs are nested inside parent worktree)
    writeFileSync(join(result.root, '.gitignore'), 'service/\n');
    git('add .gitignore', result.root);
    git('commit -m "Gitignore child worktrees"', result.root);

    // Make changes in both parent and child worktrees
    writeFileSync(join(result.root, 'parent-work.txt'), 'parent feature');
    git('add .', result.root);
    git('commit -m "Parent feature"', result.root);

    writeFileSync(join(serviceWorktree, 'service-work.txt'), 'service feature');
    git('add .', serviceWorktree);
    git('commit -m "Service feature"', serviceWorktree);

    // Sync then merge
    await syncWorkspace(branch);
    await closeWorkspace(branch, 'merge');

    // Verify changes landed in source repos
    const parentLog = git('log --oneline -1', parent);
    expect(parentLog).toContain('Parent feature');

    const childLog = git('log --oneline -1', children['service']);
    expect(childLog).toContain('Service feature');

    // Verify cleanup
    expect(existsSync(result.root)).toBe(false);
  });

  it('childRepos: empty array → single-repo workspace (no config repos)', async () => {
    // Create a grouped repo with config repos
    const { parent } = createGroupedRepos('empty-api-proj', ['config-only']);
    const branch = uniqueBranch('empty-api');

    // Pass empty childRepos — should override config and create single-repo workspace
    const result = await createWorkspace(branch, {
      from: parent,
      childRepos: [],
    });
    createdWorkspaceIds.push(result.id);

    // Should only have the parent repo
    expect(result.repos).toEqual(['empty-api-proj']);

    // Config child worktree should NOT exist
    expect(existsSync(join(result.root, 'config-only'))).toBe(false);

    await closeWorkspace(branch, 'discard');
  });

  it('childRepos: rollback on failure cleans up all repos', async () => {
    const { parent, children } = createSiblingRepos('rollback-api-proj', ['good', 'bad']);
    const branch = uniqueBranch('rollback-api');

    // Pre-create the branch in the "bad" child to cause preflight failure
    git(`branch ${branch}`, children['bad']);

    await expect(createWorkspace(branch, {
      from: parent,
      childRepos: [
        { path: children['good'], name: 'good' },
        { path: children['bad'], name: 'bad' },
      ],
    })).rejects.toThrow('already exists');

    // No worktrees should exist
    const expectedRoot = join(WORKTREE_DIR, 'rollback-api-proj', branch);
    expect(existsSync(expectedRoot)).toBe(false);
  });
});

describe('workspace e2e: public API with RepoRef', () => {
  it('create with RepoId refs → resolves via registry and creates worktrees', async () => {
    const { parent, children } = createSiblingRepos('pubapi-proj', ['backend', 'frontend']);
    const branch = uniqueBranch('pubapi');

    // Register all repos in the grove registry
    const parentEntry = await addRepo(parent);
    const backendEntry = await addRepo(children['backend']);
    const frontendEntry = await addRepo(children['frontend']);

    const result = await apiCreate(branch, {
      from: parentEntry.id,
      repos: [backendEntry.id, frontendEntry.id],
    });
    createdWorkspaceIds.push(result.id);

    // Verify worktrees created for all repos
    expect(result.repos).toHaveLength(3);
    expect(existsSync(result.root)).toBe(true);
    expect(git('branch --show-current', result.root)).toBe(branch);

    // Children are named after their registry entry names
    const backendWorktree = join(result.root, backendEntry.name);
    const frontendWorktree = join(result.root, frontendEntry.name);
    expect(existsSync(backendWorktree)).toBe(true);
    expect(existsSync(frontendWorktree)).toBe(true);
    expect(git('branch --show-current', backendWorktree)).toBe(branch);
    expect(git('branch --show-current', frontendWorktree)).toBe(branch);

    // Close and verify cleanup
    await closeWorkspace(branch, 'discard');
    expect(existsSync(result.root)).toBe(false);
  });

  it('create with RepoSpec inline paths → creates worktrees without registry', async () => {
    const { parent, children } = createSiblingRepos('spec-proj', ['lib']);
    const branch = uniqueBranch('spec');

    // Register only the parent (children use inline specs)
    const parentEntry = await addRepo(parent);

    const result = await apiCreate(branch, {
      from: parentEntry.id,
      repos: [{ path: children['lib'], name: 'my-lib' }],
    });
    createdWorkspaceIds.push(result.id);

    expect(result.repos).toContain('my-lib');

    const libWorktree = join(result.root, 'my-lib');
    expect(existsSync(libWorktree)).toBe(true);
    expect(git('branch --show-current', libWorktree)).toBe(branch);

    await closeWorkspace(branch, 'discard');
  });

  it('create with repos: [] → overrides config, single-repo workspace', async () => {
    const { parent } = createGroupedRepos('emptyref-proj', ['should-be-ignored']);
    const branch = uniqueBranch('emptyref');

    const parentEntry = await addRepo(parent);

    const result = await apiCreate(branch, {
      from: parentEntry.id,
      repos: [],
    });
    createdWorkspaceIds.push(result.id);

    // Only parent repo, config child was overridden
    expect(result.repos).toEqual(['emptyref-proj']);
    expect(existsSync(join(result.root, 'should-be-ignored'))).toBe(false);

    await closeWorkspace(branch, 'discard');
  });

  it('create with mixed RepoId and RepoSpec → both resolved correctly', async () => {
    const { parent, children } = createSiblingRepos('mixed-proj', ['registered', 'inline']);
    const branch = uniqueBranch('mixed');

    const parentEntry = await addRepo(parent);
    const registeredEntry = await addRepo(children['registered']);

    const result = await apiCreate(branch, {
      from: parentEntry.id,
      repos: [
        registeredEntry.id,
        { path: children['inline'], name: 'inline-repo' },
      ],
    });
    createdWorkspaceIds.push(result.id);

    expect(result.repos).toHaveLength(3);

    const registeredWorktree = join(result.root, registeredEntry.name);
    const inlineWorktree = join(result.root, 'inline-repo');
    expect(existsSync(registeredWorktree)).toBe(true);
    expect(existsSync(inlineWorktree)).toBe(true);

    await closeWorkspace(branch, 'discard');
  });
});
