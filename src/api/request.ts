/**
 * Grove API: Request module
 *
 * Cross-repo plan requests. Extracts core logic from commands/request.ts
 * and accepts RepoId instead of repo name strings.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { readRegistry } from '../repo/state.js';
import {
  createWorktree,
  getWorktreeBasePath,
  branchExists,
  getCurrentBranch,
} from '../workspace/git.js';
import { writeWorkspaceState } from '../workspace/state.js';
import type { WorkspaceState } from '../workspace/types.js';
import type { RepoId } from './identity.js';
import { RepoNotFoundError, BranchExistsError } from './errors.js';
import type { RequestOptions, RequestResult } from './types.js';

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function toTitle(planName: string): string {
  return planName
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function parseTrellisConfig(repoPath: string): string {
  try {
    const content = readFileSync(join(repoPath, '.trellis'), 'utf-8');
    for (const line of content.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key === 'plans_dir' && value) return value;
    }
  } catch {
    // Missing, unreadable, or malformed — fall back to default
  }
  return 'plans';
}

function detectSourceRepoName(registry: { repos: Array<{ name: string; path: string }> }): string | null {
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const repoRoot = dirname(resolve(gitCommonDir));
    const match = registry.repos.find(r => resolve(r.path) === repoRoot);
    return match ? match.name : null;
  } catch {
    return null;
  }
}

/**
 * Create a cross-repo plan request.
 *
 * Creates a worktree in the target repo with a plan file and initial commit.
 * Body is passed as a string — no file I/O (the CLI reads --body-file itself).
 */
export async function createRequest(
  targetRepo: RepoId,
  planName: string,
  options: RequestOptions,
): Promise<RequestResult> {
  // 1. Validate plan name
  if (!KEBAB_CASE_RE.test(planName)) {
    throw new Error(`Plan name must be kebab-case: my-plan-name (got "${planName}")`);
  }

  if (!options.body || options.body.trim().length === 0) {
    throw new Error('Body must not be empty');
  }

  // 2. Resolve target repo
  const registry = await readRegistry();
  const targetEntry = registry.repos.find(r => r.id === targetRepo);
  if (!targetEntry) {
    throw new RepoNotFoundError(targetRepo);
  }

  const targetRepoPath = targetEntry.path;
  const targetRepoName = targetEntry.name;

  if (!existsSync(targetRepoPath)) {
    throw new Error(`Target repo path does not exist: ${targetRepoPath}`);
  }

  // 3. Detect source repo
  let sourceRepoName: string | null = null;
  if (options.sourceRepo) {
    const sourceEntry = registry.repos.find(r => r.id === options.sourceRepo);
    sourceRepoName = sourceEntry?.name ?? null;
  } else {
    sourceRepoName = detectSourceRepoName(registry);
  }

  // 4. Refuse self-requests
  if (sourceRepoName === targetRepoName) {
    throw new Error('Cannot request from a repo to itself. Use trellis to create a plan directly.');
  }

  // 5. Resolve plans directory
  const plansDir = parseTrellisConfig(targetRepoPath);

  // 6. Determine file path
  const hasActiveDir = existsSync(join(targetRepoPath, plansDir, 'active'));
  const planRelDir = hasActiveDir ? join(plansDir, 'active') : plansDir;
  const planFileName = `${planName}.md`;
  const planRelPath = join(planRelDir, planFileName);

  // 7. Duplicate detection
  const planInRoot = join(targetRepoPath, plansDir, planFileName);
  const planInActive = join(targetRepoPath, plansDir, 'active', planFileName);
  if (existsSync(planInRoot)) {
    throw new Error(`Plan '${planName}' already exists at ${plansDir}/${planFileName}`);
  }
  if (existsSync(planInActive)) {
    throw new Error(`Plan '${planName}' already exists at ${plansDir}/active/${planFileName}`);
  }

  // 8. Check for existing branch
  const branchName = `request/${planName}`;
  if (branchExists(targetRepoPath, branchName)) {
    throw new BranchExistsError(branchName);
  }

  const currentBranch = getCurrentBranch(targetRepoPath);
  if (!currentBranch) {
    throw new Error(`Target repo '${targetRepoName}' is on a detached HEAD. Check out a branch first.`);
  }

  // 9. Create worktree
  const worktreeBasePath = getWorktreeBasePath();
  const worktreePath = join(worktreeBasePath, targetRepoName, 'request', planName);
  createWorktree(targetRepoPath, branchName, worktreePath);

  // 10. Create directories
  const planDirInWorktree = join(worktreePath, planRelDir);
  mkdirSync(planDirInWorktree, { recursive: true });

  // 11. Write the plan file
  const description = options.description || '';
  const title = toTitle(planName);
  const frontmatter = [
    '---',
    `title: ${title}`,
    'status: draft',
    `source: ${sourceRepoName || 'null'}`,
    `description: "${description}"`,
    '---',
  ].join('\n');
  const planContent = `${frontmatter}\n\n${options.body}\n`;
  const planFullPath = join(worktreePath, planRelPath);
  writeFileSync(planFullPath, planContent, 'utf-8');

  // 12. Commit
  const commitSource = sourceRepoName ? ` (from ${sourceRepoName})` : '';
  const commitMsg = `Add request: ${planName}${commitSource}`;
  execSync(`git add "${planRelPath}"`, { cwd: worktreePath, stdio: 'ignore' });
  execSync(`git -c user.email="grove@local" -c user.name="Grove" commit -m "${commitMsg}"`, {
    cwd: worktreePath,
    stdio: 'ignore',
  });

  // 13. Write workspace state
  const now = new Date();
  const state: WorkspaceState = {
    version: 1,
    id: `${targetRepoName}-request-${planName}`,
    status: 'active',
    branch: branchName,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    root: worktreePath,
    source: targetRepoPath,
    repos: [
      {
        name: targetRepoName,
        role: 'parent',
        source: targetRepoPath,
        worktree: worktreePath,
        parentBranch: currentBranch,
      },
    ],
    sync: null,
  };
  await writeWorkspaceState(state);

  return {
    file: planRelPath,
    worktree: worktreePath,
    branch: branchName,
    source: sourceRepoName,
    target: targetRepoName,
  };
}
