import type { RepoId } from '../shared/identity.js';
import { up } from '../api/environment.js';
import { load as loadConfig } from '../shared/config.js';
import { printBanner, printUrlTable } from '../shared/output.js';

export interface UpOptions {
  frontend?: string;
  all?: boolean;
}

export async function upCommand(repoId: RepoId, options: UpOptions): Promise<void> {
  const config = await loadConfig(repoId);
  printBanner(config.project.name);

  const result = await up(repoId, options);

  printUrlTable(result.urls);
}
