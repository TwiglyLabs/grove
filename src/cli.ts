/**
 * Commander-based CLI skeleton for Grove.
 *
 * Each command delegates to the existing command functions.
 * Slices will register their own subcommands during migration.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { realpathSync } from 'fs';
import { repo } from './api/index.js';
import type { RepoId } from './shared/identity.js';
import { printError } from './shared/output.js';

import {
  upCommand,
  downCommand,
  destroyCommand,
  statusCommand,
  watchCommand,
  pruneCommand,
  reloadCommand,
} from './environment/cli.js';
import { logsCommand } from './commands/logs.js';
import { testCommand } from './commands/test.js';
import { shellCommand } from './commands/shell.js';
import { workspaceCommand } from './commands/workspace.js';
import { repoCommand } from './commands/repo.js';
import { requestCommand } from './commands/request.js';

/**
 * Resolve the current repo from cwd. Finds the git root, then looks up
 * or auto-registers the repo in the registry. Returns a RepoId.
 */
export async function resolveCurrentRepo(): Promise<RepoId> {
  let gitRoot: string;
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    gitRoot = realpathSync(gitRoot);
  } catch {
    throw new Error('Not inside a git repository. Run this command from a git repo root.');
  }

  const entry = await repo.findByPath(gitRoot);
  if (entry) {
    return entry.id;
  }

  const registered = await repo.add(gitRoot);
  return registered.id;
}

function handleError(error: unknown): never {
  printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

export const program = new Command();

program
  .name('grove')
  .description('Config-driven local Kubernetes development tool')
  .version('0.1.0');

// --- Config-free commands (no resolveCurrentRepo needed) ---

program
  .command('repo')
  .description('Manage repo registry (add, remove, list)')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (_options, cmd) => {
    try {
      await repoCommand(cmd.args);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('workspace')
  .description('Manage multi-repo workspaces (create, list, status, sync, close, switch)')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (_options, cmd) => {
    try {
      await workspaceCommand(cmd.args);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('request')
  .description('File a cross-repo plan request')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (_options, cmd) => {
    try {
      await requestCommand(cmd.args);
    } catch (error) {
      handleError(error);
    }
  });

// --- Config-dependent commands (need resolveCurrentRepo) ---

program
  .command('up')
  .description('Start the development environment')
  .option('--frontend <name>', 'Start specific frontend only')
  .option('--all', 'Start all frontends')
  .action(async (options) => {
    try {
      const repoId = await resolveCurrentRepo();
      await upCommand(repoId, {
        frontend: options.frontend,
        all: options.all,
      });
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('down')
  .description('Stop all processes')
  .action(async () => {
    try {
      const repoId = await resolveCurrentRepo();
      await downCommand(repoId);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('destroy')
  .description('Stop processes and delete namespace')
  .action(async () => {
    try {
      const repoId = await resolveCurrentRepo();
      await destroyCommand(repoId);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('status')
  .description('Show environment status')
  .action(async () => {
    try {
      const repoId = await resolveCurrentRepo();
      await statusCommand(repoId);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('watch')
  .description('Watch for file changes and rebuild')
  .action(async () => {
    try {
      const repoId = await resolveCurrentRepo();
      await watchCommand(repoId);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('prune')
  .description('Clean up orphaned resources')
  .action(async () => {
    try {
      const repoId = await resolveCurrentRepo();
      await pruneCommand(repoId);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('logs <service>')
  .description('Show logs for a service')
  .option('--pod', 'Show kubectl pod logs instead of file logs')
  .allowUnknownOption()
  .action(async (service, _options, cmd) => {
    try {
      const repoId = await resolveCurrentRepo();
      await logsCommand(repoId, service, cmd.args);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('test <platform>')
  .description('Run tests (mobile|webapp|api)')
  .allowUnknownOption()
  .allowExcessArguments()
  .action(async (platform, _options, cmd) => {
    try {
      const repoId = await resolveCurrentRepo();
      await testCommand(repoId, [platform, ...cmd.args]);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('shell [service]')
  .description('Open shell in a service pod')
  .action(async (service) => {
    try {
      const repoId = await resolveCurrentRepo();
      await shellCommand(repoId, service);
    } catch (error) {
      handleError(error);
    }
  });

program
  .command('reload [service]')
  .description('Trigger service reload')
  .action(async (service) => {
    try {
      const repoId = await resolveCurrentRepo();
      await reloadCommand(repoId, service);
    } catch (error) {
      handleError(error);
    }
  });
