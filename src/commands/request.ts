import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { readRegistry } from '../repo/state.js';
import {
  createWorktree,
  getWorktreeBasePath,
  branchExists,
  getCurrentBranch,
} from '../workspace/git.js';
import { writeWorkspaceState } from '../workspace/state.js';
import type { WorkspaceState } from '../workspace/types.js';
import { printSuccess, printError, printWarning, printInfo, jsonSuccess, jsonError } from '../shared/output.js';

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fail(msg: string, json: boolean): void {
  json ? jsonError(msg) : printError(msg);
  process.exitCode = 1;
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function toTitle(planName: string): string {
  return planName
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

function parseTrellisConfig(repoPath: string): string {
  try {
    const content = readFileSync(join(repoPath, '.trellis'), 'utf-8');
    for (const line of content.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key === 'plans_dir' && value) return value;
    }
  } catch {
    // Missing, unreadable, or malformed — fall back to default
  }
  return 'plans';
}

function detectSourceRepo(registry: Awaited<ReturnType<typeof readRegistry>>): string | null {
  try {
    // --git-common-dir returns the shared .git directory, even from a worktree.
    // From main checkout: returns ".git" (relative)
    // From a worktree: returns "/path/to/main-repo/.git" (absolute)
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Resolve relative paths against cwd, then take the parent of .git
    const repoRoot = dirname(resolve(gitCommonDir));

    const match = registry.repos.find(r => resolve(r.path) === repoRoot);
    return match ? match.name : null;
  } catch {
    return null;
  }
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

  // 1. Validate plan name
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

  // 2. Resolve target repo
  const registry = await readRegistry();
  const targetEntry = registry.repos.find(r => r.name === targetRepoName);
  if (!targetEntry) {
    const msg = `Repo '${targetRepoName}' is not registered. Run 'grove repo add' first.`;
    fail(msg, json);
    return;
  }

  const targetRepoPath = targetEntry.path;
  if (!existsSync(targetRepoPath)) {
    const msg = `Target repo path does not exist: ${targetRepoPath}`;
    fail(msg, json);
    return;
  }

  // 3. Auto-detect source repo
  const sourceRepoName = detectSourceRepo(registry);

  // 4. Refuse self-requests
  if (sourceRepoName === targetRepoName) {
    const msg = 'Cannot request from a repo to itself. Use trellis to create a plan directly.';
    fail(msg, json);
    return;
  }

  // 5. Resolve plans directory
  const plansDir = parseTrellisConfig(targetRepoPath);
  if (!json && existsSync(join(targetRepoPath, '.trellis'))) {
    // Check if it parsed correctly — if plansDir is default and .trellis exists, might be malformed
    try {
      const content = readFileSync(join(targetRepoPath, '.trellis'), 'utf-8');
      const hasPlansDirKey = content.split('\n').some(line => {
        const colonIdx = line.indexOf(':');
        return colonIdx !== -1 && line.slice(0, colonIdx).trim() === 'plans_dir';
      });
      if (!hasPlansDirKey && plansDir === 'plans') {
        // That's fine — default is used
      }
    } catch {
      printWarning('Could not parse .trellis config — using default plans directory');
    }
  }

  // 6. Determine file path
  const hasActiveDir = existsSync(join(targetRepoPath, plansDir, 'active'));
  const planRelDir = hasActiveDir ? join(plansDir, 'active') : plansDir;
  const planFileName = `${planName}.md`;
  const planRelPath = join(planRelDir, planFileName);

  // 7. Duplicate detection — check in the target repo's main checkout
  const planInRoot = join(targetRepoPath, plansDir, planFileName);
  const planInActive = join(targetRepoPath, plansDir, 'active', planFileName);
  if (existsSync(planInRoot)) {
    const msg = `Plan '${planName}' already exists at ${plansDir}/${planFileName}. Choose a different name.`;
    fail(msg, json);
    return;
  }
  if (existsSync(planInActive)) {
    const msg = `Plan '${planName}' already exists at ${plansDir}/active/${planFileName}. Choose a different name.`;
    fail(msg, json);
    return;
  }

  // 8. Check for existing branch
  const branchName = `request/${planName}`;
  if (branchExists(targetRepoPath, branchName)) {
    const msg = `A request branch for '${planName}' already exists in ${targetRepoName}. Choose a different name or close the existing request.`;
    fail(msg, json);
    return;
  }

  // Check for detached HEAD
  const currentBranch = getCurrentBranch(targetRepoPath);
  if (!currentBranch) {
    const msg = `Target repo '${targetRepoName}' is on a detached HEAD. Check out a branch first.`;
    fail(msg, json);
    return;
  }

  // 9. Create worktree
  const worktreeBasePath = getWorktreeBasePath();
  const worktreePath = join(worktreeBasePath, targetRepoName, 'request', planName);
  createWorktree(targetRepoPath, branchName, worktreePath);

  // 10. Create directories
  const planDirInWorktree = join(worktreePath, planRelDir);
  mkdirSync(planDirInWorktree, { recursive: true });

  // 11. Write the plan file
  const description = getFlag(args, '--description') || '';
  const title = toTitle(planName);
  const frontmatter = [
    '---',
    `title: ${title}`,
    'status: draft',
    `source: ${sourceRepoName || 'null'}`,
    `description: "${description}"`,
    '---',
  ].join('\n');
  const planContent = `${frontmatter}\n\n${body}\n`;
  const planFullPath = join(worktreePath, planRelPath);
  writeFileSync(planFullPath, planContent, 'utf-8');

  // 12. Commit
  const commitSource = sourceRepoName ? ` (from ${sourceRepoName})` : '';
  const commitMsg = `Add request: ${planName}${commitSource}`;
  execSync(`git add "${planRelPath}"`, { cwd: worktreePath, stdio: 'ignore' });
  execSync(`git -c user.email="grove@local" -c user.name="Grove" commit -m "${commitMsg}"`, {
    cwd: worktreePath,
    stdio: 'ignore',
  });

  // 13. Write workspace state
  const now = new Date();
  const state: WorkspaceState = {
    version: 1,
    id: `${targetRepoName}-request-${planName}`,
    status: 'active',
    branch: branchName,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    root: worktreePath,
    source: targetRepoPath,
    repos: [
      {
        name: targetRepoName,
        role: 'parent',
        source: targetRepoPath,
        worktree: worktreePath,
        parentBranch: currentBranch,
      },
    ],
    sync: null,
  };
  await writeWorkspaceState(state);

  // 14. Print result
  if (json) {
    jsonSuccess({
      file: planRelPath,
      worktree: worktreePath,
      branch: branchName,
      source: sourceRepoName,
      target: targetRepoName,
    });
  } else {
    printSuccess(`Request created: ${planName}`);
    printInfo(`  Worktree: ${worktreePath}`);
    printInfo(`  Branch:   ${branchName}`);
    printInfo(`  Plan:     ${planRelPath}`);
  }
}
