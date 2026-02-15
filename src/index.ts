#!/usr/bin/env node

import { execSync } from 'child_process';
import { realpathSync } from 'fs';
import { repo } from './api/index.js';
import type { RepoId } from './api/identity.js';
import { upCommand } from './commands/up.js';
import { downCommand } from './commands/down.js';
import { destroyCommand } from './commands/destroy.js';
import { statusCommand } from './commands/status.js';
import { watchCommand } from './commands/watch.js';
import { pruneCommand } from './commands/prune.js';
import { logsCommand } from './commands/logs.js';
import { testCommand } from './commands/test.js';
import { shellCommand } from './commands/shell.js';
import { reloadCommand } from './commands/reload.js';
import { workspaceCommand } from './commands/workspace.js';
import { repoCommand } from './commands/repo.js';
import { requestCommand } from './commands/request.js';
import { printError } from './output.js';

function printUsage(): void {
  console.log(`
Grove - Config-driven local Kubernetes development tool

Usage:
  grove up [--frontend <name>] [--all]    Start the development environment
  grove down                               Stop all processes
  grove destroy                            Stop processes and delete namespace
  grove status                             Show environment status
  grove watch                              Watch for file changes and rebuild
  grove prune                              Clean up orphaned resources
  grove logs <service> [--pod]             Show logs for a service
  grove test <mobile|webapp|api> [opts]    Run tests
  grove shell <service>                    Open shell in a service pod
  grove reload <service>                   Trigger service reload
  grove repo <subcommand>                  Manage repo registry (add, remove, list)
                                           Run 'grove repo help' for details
  grove workspace <subcommand>             Manage multi-repo workspaces (create, list, status, sync, close, switch)
                                           Run 'grove workspace help' for details
  grove request <target> <plan> --body ..  File a cross-repo plan request
                                           Run 'grove request --help' for details

Options:
  --frontend <name>   Start specific frontend only (for 'up' command)
  --all              Start all frontends (for 'up' command)
  --pod              Show kubectl pod logs instead of file logs (for 'logs')

Test options:
  --suite <name>     Named test suite (mobile)
  --flow <path>      Flow path, repeatable (mobile)
  --file <path>      Test file filter (webapp, api)
  --grep <pattern>   Test name filter (webapp, api)
  --use-dev          Use dev environment for API URL (api)
  --ai               Include AI tests (api)
  --exclude-ai       Exclude AI tests (api)
  --no-ensure        Skip auto-ensure
  --timeout <ms>     Timeout in milliseconds
  --verbose          Verbose output
  `);
}

/**
 * Resolve the current repo from cwd. Finds the git root, then looks up
 * or auto-registers the repo in the registry. Returns a RepoId.
 */
async function resolveCurrentRepo(): Promise<RepoId> {
  // Find git root from cwd
  let gitRoot: string;
  try {
    gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    gitRoot = realpathSync(gitRoot);
  } catch {
    throw new Error('Not inside a git repository. Run this command from a git repo root.');
  }

  // Look up in registry
  const entry = await repo.findByPath(gitRoot);
  if (entry) {
    return entry.id;
  }

  // Auto-register the repo
  const registered = await repo.add(gitRoot);
  return registered.id;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  // Repo and workspace commands don't need grove config
  if (command === 'repo') {
    try {
      await repoCommand(args.slice(1));
    } catch (error) {
      printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'workspace') {
    try {
      await workspaceCommand(args.slice(1));
    } catch (error) {
      printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    return;
  }

  if (command === 'request') {
    try {
      await requestCommand(args.slice(1));
    } catch (error) {
      printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    return;
  }

  try {
    const repoId = await resolveCurrentRepo();

    switch (command) {
      case 'up': {
        const options = {
          frontend: args.includes('--frontend') ? args[args.indexOf('--frontend') + 1] : undefined,
          all: args.includes('--all'),
        };
        await upCommand(repoId, options);
        break;
      }

      case 'down': {
        await downCommand(repoId);
        break;
      }

      case 'destroy': {
        await destroyCommand(repoId);
        break;
      }

      case 'status': {
        await statusCommand(repoId);
        break;
      }

      case 'watch': {
        await watchCommand(repoId);
        break;
      }

      case 'prune': {
        await pruneCommand(repoId);
        break;
      }

      case 'logs': {
        const serviceName = args[1];
        if (!serviceName) {
          printError('Please specify a service name');
          process.exit(1);
        }
        await logsCommand(repoId, serviceName, args.slice(2));
        break;
      }

      case 'test': {
        await testCommand(repoId, args.slice(1));
        break;
      }

      case 'shell': {
        await shellCommand(repoId, args[1]);
        break;
      }

      case 'reload': {
        await reloadCommand(repoId, args[1]);
        break;
      }

      default: {
        printError(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
      }
    }
  } catch (error) {
    printError(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
