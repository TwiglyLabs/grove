/**
 * Repo slice — CLI subcommand
 *
 * Commander subcommand for `grove repo` with add, remove, list operations.
 */

import { execSync } from 'child_process';
import { realpathSync } from 'fs';
import { resolve } from 'path';
import * as repo from './api.js';
import { printSuccess, printError, printInfo, jsonSuccess, jsonError } from '../shared/output.js';

interface RepoContext {
  json: boolean;
}

function parseArgs(args: string[]): { subcommand: string; rest: string[]; ctx: RepoContext } {
  const json = args.includes('--json');
  const filtered = args.filter(a => a !== '--json');
  const subcommand = filtered[0] || '';
  const rest = filtered.slice(1);
  return { subcommand, rest, ctx: { json } };
}

export async function repoCommand(args: string[]): Promise<void> {
  const { subcommand, rest, ctx } = parseArgs(args);

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    printRepoUsage();
    return;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    printRepoUsage();
    return;
  }

  switch (subcommand) {
    case 'add':
      return handleAdd(rest, ctx);
    case 'remove':
      return handleRemove(rest, ctx);
    case 'list':
      return handleList(ctx);
    default:
      printRepoUsage();
      if (subcommand) {
        printError(`Unknown repo subcommand: ${subcommand}`);
        process.exitCode = 1;
      }
  }
}

function getGitToplevel(dir: string): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

async function handleAdd(args: string[], ctx: RepoContext): Promise<void> {
  const pathArg = args.find(a => !a.startsWith('--'));
  const targetPath = realpathSync(resolve(pathArg || process.cwd()));

  try {
    const toplevel = getGitToplevel(targetPath);
    if (!toplevel) {
      throw new Error(`Not a git repository: ${targetPath}`);
    }

    // Reject if target is not the git root (running from subdirectory)
    const resolvedToplevel = realpathSync(toplevel);
    if (resolvedToplevel !== targetPath) {
      throw new Error(
        `Path is not a git root. Register from the repo root instead: ${resolvedToplevel}`,
      );
    }

    // Check if already registered
    const existing = await repo.findByPath(resolvedToplevel);
    if (existing) {
      if (ctx.json) {
        jsonSuccess({ name: existing.name, path: existing.path, alreadyRegistered: true });
      } else {
        printInfo(`Already registered: ${existing.name} (${existing.path})`);
      }
      return;
    }

    const result = await repo.add(resolvedToplevel);

    if (ctx.json) {
      jsonSuccess({ name: result.name, path: result.path, alreadyRegistered: false });
    } else {
      printSuccess(`Registered repo: ${result.name} (${result.path})`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleRemove(args: string[], ctx: RepoContext): Promise<void> {
  const name = args.find(a => !a.startsWith('--'));
  if (!name) {
    const msg = 'Usage: grove repo remove <name>';
    ctx.json ? jsonError(msg) : printError(msg);
    return;
  }

  try {
    // Look up by name — find the entry with matching name
    const entries = await repo.list();
    const entry = entries.find(e => e.name === name);
    if (!entry) {
      throw new Error(`Repo not found: ${name}`);
    }

    await repo.remove(entry.id);
    if (ctx.json) {
      jsonSuccess({ name });
    } else {
      printSuccess(`Removed repo: ${name}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleList(ctx: RepoContext): Promise<void> {
  try {
    const entries = await repo.list();
    if (ctx.json) {
      // Maintain backwards-compatible JSON format
      jsonSuccess({
        repos: entries.map(e => ({
          name: e.name,
          path: e.path,
          exists: e.exists,
          workspaces: Array(e.workspaceCount).fill(null).map(() => ({})),
        })),
      });
    } else {
      if (entries.length === 0) {
        printInfo('No repos registered. Use `grove repo add` to register a repo.');
        return;
      }
      for (const entry of entries) {
        const stale = entry.exists ? '' : ' [MISSING]';
        const wsCount = entry.workspaceCount > 0
          ? ` (${entry.workspaceCount} workspace${entry.workspaceCount === 1 ? '' : 's'})`
          : '';
        console.log(`  ${entry.name}  ${entry.path}${stale}${wsCount}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

function printRepoUsage(): void {
  console.log(`
grove repo <command> [options]

  Manage the repo registry. Repos registered here appear in the dashboard
  and can be used as workspace sources.

Commands:
  add [<path>]      Register a git repo (defaults to current directory)
  remove <name>     Unregister a repo by name
  list              List all registered repos
  help              Show this help

Global options:
  --json            Machine-readable JSON output (envelope: { ok, data } or { ok, error })
  --help, -h        Show help

Examples:
  grove repo add                     # register current directory
  grove repo add /path/to/repo       # register specific path
  grove repo remove dotfiles         # unregister by name
  grove repo list                    # list all repos
  grove repo list --json             # JSON output for dashboard
`);
}
