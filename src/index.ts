#!/usr/bin/env node

import { loadConfig } from './config.js';
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];

  try {
    const config = loadConfig();

    switch (command) {
      case 'up': {
        const options = {
          frontend: args.includes('--frontend') ? args[args.indexOf('--frontend') + 1] : undefined,
          all: args.includes('--all'),
        };
        await upCommand(config, options);
        break;
      }

      case 'down': {
        await downCommand(config);
        break;
      }

      case 'destroy': {
        await destroyCommand(config);
        break;
      }

      case 'status': {
        await statusCommand(config);
        break;
      }

      case 'watch': {
        await watchCommand(config);
        break;
      }

      case 'prune': {
        await pruneCommand(config);
        break;
      }

      case 'logs': {
        const serviceName = args[1];
        if (!serviceName) {
          printError('Please specify a service name');
          process.exit(1);
        }
        await logsCommand(config, serviceName, args.slice(2));
        break;
      }

      case 'test': {
        await testCommand(config, args.slice(1));
        break;
      }

      case 'shell': {
        await shellCommand(config, args[1]);
        break;
      }

      case 'reload': {
        await reloadCommand(config, args[1]);
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
