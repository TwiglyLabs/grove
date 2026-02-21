/**
 * Request slice — CLI subcommand
 *
 * Thin CLI wrapper that delegates to createRequest() API.
 * Handles arg parsing, --body-file reading, repo name resolution, output formatting.
 */

import { existsSync, readFileSync } from 'fs';
import { readRegistry } from '../repo/state.js';
import { asRepoId } from '../shared/identity.js';
import { printSuccess, printError, printInfo, jsonSuccess, jsonError } from '../shared/output.js';
import { RepoNotFoundError, BranchExistsError } from '../shared/errors.js';
import { createRequest } from './api.js';

function fail(msg: string, json: boolean): void {
  json ? jsonError(msg) : printError(msg);
  process.exitCode = 1;
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function printUsage(): void {
  console.log(`
grove request - File a cross-repo plan request

Usage:
  grove request <target-repo> <plan-name> --body <markdown> [--description <text>] [--json]
  grove request <target-repo> <plan-name> --body-file <path> [--description <text>] [--json]

Arguments:
  target-repo   Name of a repo in the grove registry
  plan-name     Kebab-case name for the plan (e.g. fix-api-v2)

Flags:
  --body <markdown>     Request content (the ask, context, motivation)
  --body-file <path>    Read request content from a file (mutually exclusive with --body)
  --description <text>  Optional one-line description for frontmatter
  --json                Output structured JSON
  --help                Show this help
`);
}

export async function requestCommand(args: string[]): Promise<void> {
  const json = args.includes('--json');

  // Help / no args
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }

  // Parse positional args (skip flags)
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--body' || arg === '--body-file' || arg === '--description') {
      i++; // skip the flag value
    } else if (arg === '--json') {
      // skip
    } else {
      positional.push(arg);
    }
  }

  const targetRepoName = positional[0];
  const planName = positional[1];

  if (!targetRepoName || !planName) {
    const msg = 'Usage: grove request <target-repo> <plan-name> --body <markdown>';
    fail(msg, json);
    return;
  }

  // Validate plan name early (before registry lookup for better UX)
  const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!KEBAB_CASE_RE.test(planName)) {
    const msg = `Plan name must be kebab-case: my-plan-name (got "${planName}")`;
    fail(msg, json);
    return;
  }

  // Validate body flags
  const bodyFlag = getFlag(args, '--body');
  const bodyFileFlag = getFlag(args, '--body-file');

  if (bodyFlag !== undefined && bodyFileFlag !== undefined) {
    const msg = '--body and --body-file are mutually exclusive';
    fail(msg, json);
    return;
  }

  if (bodyFlag === undefined && bodyFileFlag === undefined) {
    const msg = 'Either --body or --body-file is required';
    fail(msg, json);
    return;
  }

  let body: string;
  if (bodyFileFlag !== undefined) {
    if (!existsSync(bodyFileFlag)) {
      const msg = `Body file does not exist: ${bodyFileFlag}`;
      fail(msg, json);
      return;
    }
    body = readFileSync(bodyFileFlag, 'utf-8');
  } else {
    body = bodyFlag!;
  }

  if (!body || body.trim().length === 0) {
    const msg = 'Body must not be empty';
    fail(msg, json);
    return;
  }

  // Resolve target repo name to RepoId
  const registry = await readRegistry();
  const targetEntry = registry.repos.find(r => r.name === targetRepoName);
  if (!targetEntry) {
    const msg = `Repo '${targetRepoName}' is not registered. Run 'grove repo add' first.`;
    fail(msg, json);
    return;
  }

  const targetRepoId = asRepoId(targetEntry.id!);
  const description = getFlag(args, '--description');

  try {
    const result = await createRequest(targetRepoId, planName, {
      body,
      description,
    });

    if (json) {
      jsonSuccess({
        file: result.file,
        worktree: result.worktree,
        branch: result.branch,
        source: result.source,
        target: result.target,
      });
    } else {
      printSuccess(`Request created: ${planName}`);
      printInfo(`  Worktree: ${result.worktree}`);
      printInfo(`  Branch:   ${result.branch}`);
      printInfo(`  Plan:     ${result.file}`);
    }
  } catch (error) {
    if (error instanceof RepoNotFoundError) {
      fail(`Target repo path does not exist: ${error.message}`, json);
    } else if (error instanceof BranchExistsError) {
      const msg = `A request branch for '${planName}' already exists in ${targetRepoName}. Choose a different name or close the existing request.`;
      fail(msg, json);
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      fail(msg, json);
    }
  }
}
