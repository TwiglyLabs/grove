import { existsSync } from 'fs';
import { listWorkspaceStates, readWorkspaceState, findWorkspaceByBranch } from './state.js';
import { getRepoStatus } from './git.js';
import { formatAge } from '../output.js';
import type { WorkspaceState } from './types.js';

export interface WorkspaceListItem {
  id: string;
  branch: string;
  status: string;
  root: string;
  repos: string[];
  createdAt: string;
  age: string;
  missing: boolean;
}

export function listWorkspaces(): WorkspaceListItem[] {
  return listWorkspaceStates().map(s => ({
    id: s.id,
    branch: s.branch,
    status: s.status,
    root: s.root,
    repos: s.repos.map(r => r.name),
    createdAt: s.createdAt,
    age: formatAge(new Date(s.createdAt)),
    missing: !existsSync(s.root),
  }));
}

export interface WorkspaceStatusRepo {
  name: string;
  role: 'parent' | 'child';
  dirty: number;
  commits: number;
  syncStatus: string | null;
}

export interface WorkspaceStatusResult {
  id: string;
  status: string;
  branch: string;
  repos: WorkspaceStatusRepo[];
}

export function getWorkspaceStatus(branchOrId?: string): WorkspaceStatusResult {
  let state: WorkspaceState | null = null;

  if (branchOrId) {
    // Try as workspace ID first, then as branch
    state = readWorkspaceState(branchOrId) ?? findWorkspaceByBranch(branchOrId);
  } else {
    // Auto-detect from cwd
    state = detectWorkspaceFromCwd();
  }

  if (!state) {
    throw new Error(
      branchOrId
        ? `No workspace found for '${branchOrId}'`
        : 'Not inside a workspace. Specify a branch name or run from a workspace directory.',
    );
  }

  const repos: WorkspaceStatusRepo[] = state.repos.map(repo => {
    let dirty = 0;
    let commits = 0;

    if (existsSync(repo.worktree)) {
      const status = getRepoStatus(repo.worktree, repo.parentBranch);
      dirty = status.dirty;
      commits = status.commits;
    }

    const syncStatus = state!.sync?.repos[repo.name] ?? null;

    return {
      name: repo.name,
      role: repo.role,
      dirty,
      commits,
      syncStatus,
    };
  });

  return {
    id: state.id,
    status: state.status,
    branch: state.branch,
    repos,
  };
}

function detectWorkspaceFromCwd(): WorkspaceState | null {
  const states = listWorkspaceStates();
  const cwd = process.cwd();

  // Check if cwd is inside any workspace's worktree root
  for (const state of states) {
    if (cwd === state.root || cwd.startsWith(state.root + '/')) {
      return state;
    }
  }

  return null;
}
