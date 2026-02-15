import { existsSync } from 'fs';
import { readRegistry } from './state.js';
import { listWorkspaceStates } from '../workspace/state.js';

export interface RepoWorkspaceSummary {
  id: string;
  branch: string;
  status: string;
  root: string;
  repoCount: number;
}

export interface RepoListItem {
  name: string;
  path: string;
  exists: boolean;
  workspaces: RepoWorkspaceSummary[];
}

export interface RepoListResult {
  repos: RepoListItem[];
}

export function listRepos(): RepoListResult {
  const registry = readRegistry();
  const workspaces = listWorkspaceStates();

  const repos: RepoListItem[] = registry.repos
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => {
      const matching = workspaces.filter(ws => ws.source === entry.path);

      return {
        name: entry.name,
        path: entry.path,
        exists: existsSync(entry.path),
        workspaces: matching.map(ws => ({
          id: ws.id,
          branch: ws.branch,
          status: ws.status,
          root: ws.root,
          repoCount: ws.repos.length,
        })),
      };
    });

  return { repos };
}
