import { execSync } from 'child_process';
import { existsSync, accessSync, constants as fsConstants } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function gitNoThrow(args: string, cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: git(args, cwd) };
  } catch {
    return { ok: false, output: '' };
  }
}

export function getWorktreeBasePath(): string {
  return process.env.GROVE_WORKTREE_DIR || join(homedir(), 'worktrees');
}

/**
 * Check if the worktree base path (or its parent) is writable.
 * Returns null if writable, or an error message string.
 */
export function validateWorktreeBasePath(): string | null {
  const basePath = getWorktreeBasePath();
  try {
    if (existsSync(basePath)) {
      accessSync(basePath, fsConstants.W_OK);
    } else {
      const parentDir = join(basePath, '..');
      if (existsSync(parentDir)) {
        accessSync(parentDir, fsConstants.W_OK);
      } else {
        return `Worktree base path parent does not exist: ${parentDir}`;
      }
    }
    return null;
  } catch {
    return `Worktree base path is not writable: ${basePath}`;
  }
}

export function isGitRepo(path: string): boolean {
  if (!existsSync(path)) return false;
  return gitNoThrow('rev-parse --git-dir', path).ok;
}

export function getCurrentBranch(repoPath: string): string {
  return git('branch --show-current', repoPath);
}

export function branchExists(source: string, branch: string): boolean {
  return gitNoThrow(`rev-parse --verify ${branch}`, source).ok;
}

export function createWorktree(source: string, branch: string, targetPath: string): void {
  git(`worktree add -b ${branch} ${targetPath}`, source);
}

export function removeWorktree(source: string, worktreePath: string, force = false): void {
  const forceFlag = force ? ' --force' : '';
  git(`worktree remove${forceFlag} ${worktreePath}`, source);
}

export function deleteBranch(source: string, branch: string, force = false): void {
  const flag = force ? '-D' : '-d';
  git(`branch ${flag} ${branch}`, source);
}

export interface RepoStatus {
  dirty: number;
  commits: number;
}

export function getRepoStatus(worktreePath: string, parentBranch: string): RepoStatus {
  // Count dirty files
  const statusOutput = gitNoThrow('status --porcelain', worktreePath);
  const dirty = statusOutput.ok
    ? statusOutput.output.split('\n').filter(l => l.trim().length > 0).length
    : 0;

  // Count commits ahead of parent branch
  const branch = getCurrentBranch(worktreePath);
  const logResult = gitNoThrow(`rev-list --count ${parentBranch}..${branch}`, worktreePath);
  const commits = logResult.ok ? parseInt(logResult.output, 10) || 0 : 0;

  return { dirty, commits };
}

export function isMergeInProgress(worktreePath: string): boolean {
  // For worktrees, MERGE_HEAD is in the worktree's git dir, not the main .git
  const gitDirResult = gitNoThrow('rev-parse --git-dir', worktreePath);
  if (!gitDirResult.ok) return false;
  return existsSync(join(gitDirResult.output, 'MERGE_HEAD'));
}

export function getConflictedFiles(worktreePath: string): string[] {
  const result = gitNoThrow('diff --name-only --diff-filter=U', worktreePath);
  if (!result.ok || !result.output) return [];
  return result.output.split('\n').filter(l => l.trim().length > 0);
}

export function hasDirtyWorkingTree(worktreePath: string): boolean {
  const result = gitNoThrow('status --porcelain', worktreePath);
  return result.ok && result.output.trim().length > 0;
}

export function fetch(worktreePath: string): void {
  git('fetch origin', worktreePath);
}

export function merge(worktreePath: string, ref: string): { ok: boolean; conflicts: string[] } {
  const result = gitNoThrow(`merge ${ref}`, worktreePath);
  if (result.ok) return { ok: true, conflicts: [] };

  const conflicts = getConflictedFiles(worktreePath);
  return { ok: false, conflicts };
}

export function mergeFFOnly(source: string, branch: string): boolean {
  return gitNoThrow(`merge --ff-only ${branch}`, source).ok;
}

export function canFFMerge(source: string, parentBranch: string, workspaceBranch: string): boolean {
  // Verify both refs exist — avoids masking bad-ref errors (exit 128) as "can't FF"
  if (!gitNoThrow(`rev-parse --verify ${parentBranch}`, source).ok) {
    throw new Error(`Branch '${parentBranch}' not found in ${source}`);
  }
  if (!gitNoThrow(`rev-parse --verify ${workspaceBranch}`, source).ok) {
    throw new Error(`Branch '${workspaceBranch}' not found in ${source}`);
  }
  // FF is possible when parent branch tip is ancestor of workspace branch tip.
  // merge-base --is-ancestor works on refs directly — no checkout needed.
  // Exit code 0 = is ancestor (FF possible), exit code 1 = not ancestor.
  return gitNoThrow(`merge-base --is-ancestor ${parentBranch} ${workspaceBranch}`, source).ok;
}

export function checkout(repoPath: string, branch: string): void {
  git(`checkout ${branch}`, repoPath);
}

export function mergeAbort(worktreePath: string): void {
  gitNoThrow('merge --abort', worktreePath);
}
