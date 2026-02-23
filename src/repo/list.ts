import { access } from 'fs/promises';
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

export async function listRepos(): Promise<RepoListResult> {
  const registry = await readRegistry();
  const workspaces = await listWorkspaceStates();

  const sorted = registry.repos
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const repos: RepoListItem[] = await Promise.all(
    sorted.map(async entry => {
      const matching = workspaces.filter(ws => ws.source === entry.path);
      const exists = await access(entry.path).then(() => true, () => false);

      return {
        name: entry.name,
        path: entry.path,
        exists,
        workspaces: matching.map(ws => ({
          id: ws.id,
          branch: ws.branch,
          status: ws.status,
          root: ws.root,
          repoCount: ws.repos.length,
        })),
      };
    }),
  );

  return { repos };
}
