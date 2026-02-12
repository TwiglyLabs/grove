#!/usr/bin/env node

import { loadConfig } from './config.js';
import { upCommand } from './commands/up.js';
import { downCommand } from './commands/down.js';
import { destroyCommand } from './commands/destroy.js';
import { statusCommand } from './commands/status.js';
import { watchCommand } from './commands/watch.js';
import { pruneCommand } from './commands/prune.js';
import { logsCommand } from './commands/logs.js';
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
  grove logs <service>                     Show logs for a service

Options:
  --frontend <name>   Start specific frontend only (for 'up' command)
  --all              Start all frontends (for 'up' command)
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
        await logsCommand(config, serviceName);
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
