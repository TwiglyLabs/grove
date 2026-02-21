import type { RepoId } from '../shared/identity.js';

export interface RequestOptions {
  body: string;
  description?: string;
  sourceRepo?: RepoId;
}

export interface RequestResult {
  file: string;
  worktree: string;
  branch: string;
  source: string | null;
  target: string;
}
