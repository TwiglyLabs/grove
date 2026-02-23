import { createWorkspace } from './create.js';
import { listWorkspaces, getWorkspaceStatus } from './status.js';
import { syncWorkspace, ConflictError } from './sync.js';
import { closeWorkspace } from './close.js';
import { readWorkspaceState, findWorkspaceByBranch } from './state.js';
import { describe as describeWorkspace } from './api.js';
import { printSuccess, printError, printInfo, printWarning, jsonSuccess, jsonError } from '../shared/output.js';

interface WorkspaceContext {
  json: boolean;
}

function parseArgs(args: string[]): { subcommand: string; rest: string[]; ctx: WorkspaceContext } {
  const json = args.includes('--json');
  const filtered = args.filter(a => a !== '--json');
  const subcommand = filtered[0] || '';
  const rest = filtered.slice(1);
  return { subcommand, rest, ctx: { json } };
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export async function workspaceCommand(args: string[]): Promise<void> {
  const { subcommand, rest, ctx } = parseArgs(args);

  // Handle --help or 'help' for any subcommand
  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    const helpTarget = rest[0];
    if (helpTarget && subcommandHelp[helpTarget]) {
      console.log(subcommandHelp[helpTarget]);
    } else {
      printWorkspaceUsage();
    }
    return;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    if (subcommandHelp[subcommand]) {
      console.log(subcommandHelp[subcommand]);
    } else {
      printWorkspaceUsage();
    }
    return;
  }

  switch (subcommand) {
    case 'create':
      return handleCreate(rest, ctx);
    case 'list':
      return handleList(ctx);
    case 'status':
      return handleStatus(rest, ctx);
    case 'sync':
      return handleSync(rest, ctx);
    case 'close':
      return handleClose(rest, ctx);
    case 'switch':
      return handleSwitch(rest, ctx);
    case 'describe':
      return handleDescribe(rest, ctx);
    default:
      printWorkspaceUsage();
      if (subcommand) {
        printError(`Unknown workspace subcommand: ${subcommand}`);
        process.exitCode = 1;
      }
  }
}

async function handleCreate(args: string[], ctx: WorkspaceContext): Promise<void> {
  const branch = args.find(a => !a.startsWith('--'));
  if (!branch) {
    const msg = 'Usage: grove workspace create <branch> [--from <path>]';
    ctx.json ? jsonError(msg) : printError(msg);
    return;
  }

  const from = getFlag(args, '--from');

  try {
    const result = await createWorkspace(branch, { from });
    if (ctx.json) {
      jsonSuccess(result);
    } else {
      printSuccess(`Workspace created: ${result.id}`);
      printInfo(`Root: ${result.root}`);
      printInfo(`Branch: ${result.branch}`);
      printInfo(`Repos: ${result.repos.join(', ')}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleList(ctx: WorkspaceContext): Promise<void> {
  try {
    const workspaces = await listWorkspaces();
    if (ctx.json) {
      jsonSuccess({ workspaces });
    } else {
      if (workspaces.length === 0) {
        printInfo('No workspaces found');
        return;
      }
      for (const ws of workspaces) {
        const warn = ws.missing ? ' [MISSING]' : '';
        console.log(`  ${ws.id}  ${ws.branch}  ${ws.status}  ${ws.age}  ${ws.root}${warn}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleStatus(args: string[], ctx: WorkspaceContext): Promise<void> {
  const branchOrId = args.find(a => !a.startsWith('--'));

  try {
    const status = await getWorkspaceStatus(branchOrId);
    if (ctx.json) {
      jsonSuccess(status);
    } else {
      console.log(`  Workspace: ${status.id}  Status: ${status.status}  Branch: ${status.branch}`);
      for (const repo of status.repos) {
        const sync = repo.syncStatus ? ` sync:${repo.syncStatus}` : '';
        console.log(`    ${repo.role === 'parent' ? '*' : ' '} ${repo.name}  dirty:${repo.dirty}  commits:${repo.commits}${sync}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleSync(args: string[], ctx: WorkspaceContext): Promise<void> {
  const branch = args.find(a => !a.startsWith('--'));
  const verbose = args.includes('--verbose');
  if (!branch) {
    const msg = 'Usage: grove workspace sync <branch>';
    ctx.json ? jsonError(msg) : printError(msg);
    return;
  }

  try {
    const result = await syncWorkspace(branch);
    if (ctx.json) {
      jsonSuccess(result);
    } else {
      printSuccess(`All repos synced for workspace '${branch}'`);
      if (verbose) {
        for (const d of result.details) {
          printInfo(`  ${d.name}: ${d.status}`);
        }
      }
    }
  } catch (error) {
    if (error instanceof ConflictError) {
      const msg = error.message;
      const data = {
        conflicted: error.conflicted,
        files: error.files,
        resolved: error.resolved,
        pending: error.pending,
      };
      ctx.json ? jsonError(msg, data) : printError(msg);
    } else {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.json ? jsonError(msg) : printError(msg);
    }
  }
}

async function handleClose(args: string[], ctx: WorkspaceContext): Promise<void> {
  const branch = args.find(a => !a.startsWith('--'));
  const mode = args.includes('--merge') ? 'merge' : args.includes('--discard') ? 'discard' : null;
  const dryRun = args.includes('--dry-run');

  if (!branch || !mode) {
    const msg = 'Usage: grove workspace close <branch> --merge|--discard [--dry-run]';
    ctx.json ? jsonError(msg) : printError(msg);
    return;
  }

  try {
    const dryRunResult = await closeWorkspace(branch, mode, { dryRun });
    if (dryRun && dryRunResult) {
      if (ctx.json) {
        jsonSuccess(dryRunResult);
      } else {
        printInfo(`Dry run — would merge the following:`);
        for (const r of dryRunResult.repos) {
          printInfo(`  ${r.name}: ${r.commits} commit(s)`);
        }
      }
      return;
    }
    if (ctx.json) {
      jsonSuccess({ branch, mode });
    } else {
      printSuccess(`Workspace '${branch}' closed (${mode})`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleSwitch(args: string[], ctx: WorkspaceContext): Promise<void> {
  const branch = args.find(a => !a.startsWith('--'));
  if (!branch) {
    const msg = 'Usage: grove workspace switch <branch>';
    ctx.json ? jsonError(msg) : printError(msg);
    return;
  }

  try {
    const state = await readWorkspaceState(branch) ?? await findWorkspaceByBranch(branch);
    if (!state) {
      throw new Error(`No workspace found for '${branch}'`);
    }
    if (ctx.json) {
      jsonSuccess({ path: state.root });
    } else {
      // Print just the path so it can be used with: cd $(grove workspace switch <branch>)
      console.log(state.root);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

async function handleDescribe(args: string[], ctx: WorkspaceContext): Promise<void> {
  const branchOrId = args.find(a => !a.startsWith('--'));
  if (!branchOrId) {
    const msg = 'Usage: grove workspace describe <branch|id>';
    ctx.json ? jsonError(msg) : printError(msg);
    return;
  }

  try {
    const descriptor = await describeWorkspace(branchOrId as import('../shared/identity.js').WorkspaceId);
    if (ctx.json) {
      jsonSuccess(descriptor);
    } else {
      console.log(`  Workspace: ${descriptor.workspace.id}  Branch: ${descriptor.workspace.branch}`);
      console.log(`  Repos:`);
      for (const repo of descriptor.workspace.repos) {
        console.log(`    ${repo.role === 'parent' ? '*' : ' '} ${repo.name}  ${repo.path}`);
      }
      if (descriptor.services.length > 0) {
        console.log(`  Services:`);
        for (const svc of descriptor.services) {
          console.log(`    ${svc.name}  ${svc.url}  :${svc.port}`);
        }
      }
      if (descriptor.frontends.length > 0) {
        console.log(`  Frontends:`);
        for (const fe of descriptor.frontends) {
          console.log(`    ${fe.name}  ${fe.url}  cwd:${fe.cwd}`);
        }
      }
      if (Object.keys(descriptor.testing.commands).length > 0) {
        console.log(`  Testing:`);
        for (const [platform, runner] of Object.entries(descriptor.testing.commands)) {
          console.log(`    ${platform}: ${runner}`);
        }
      }
      if (descriptor.shell.targets.length > 0) {
        console.log(`  Shell targets: ${descriptor.shell.targets.join(', ')}`);
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.json ? jsonError(msg) : printError(msg);
  }
}

const subcommandHelp: Record<string, string> = {
  create: `
grove workspace create <branch> [options]

  Create an isolated workspace with git worktrees for one or more repos.

  If the current repo has a .grove.yaml with a workspace.repos section, creates
  a grouped workspace: a parent worktree plus child worktrees nested inside it,
  all on the same branch. Otherwise, creates a simple single-repo workspace.

  Runs preflight checks before any git mutations. If any check fails, nothing is
  touched. If worktree creation fails partway through, all changes are rolled back
  and the workspace is marked as 'failed' (retry will auto-clean the failed state).

Arguments:
  <branch>       Branch name for the workspace (must not already exist)

Options:
  --from <path>  Source repo path (default: current working directory)
  --json         Output result as JSON: { ok, data: { id, root, branch, repos } }

Examples:
  grove workspace create feature-auth
  grove workspace create feature-auth --from /path/to/repo
  grove workspace create feature-auth --json

Lifecycle: create → [work] → sync → close --merge
`,

  list: `
grove workspace list [options]

  List all workspaces with their status, age, and root path.

  Workspaces whose root directory no longer exists on disk are flagged [MISSING].
  These can be cleaned up with: grove workspace close <branch> --discard

Options:
  --json    Output as JSON: { ok, data: { workspaces: [...] } }

Output columns: id, branch, status, age, root
Status values: creating, active, closing, failed

Examples:
  grove workspace list
  grove workspace list --json
`,

  status: `
grove workspace status [<branch>] [options]

  Show detailed status for a workspace, including per-repo dirty file count,
  commit count ahead of parent branch, and sync status.

  If <branch> is omitted, auto-detects the workspace from the current working
  directory (must be inside a workspace's worktree).

Arguments:
  [<branch>]     Branch name or workspace ID (optional if inside a workspace)

Options:
  --json         Output as JSON: { ok, data: { id, status, branch, repos: [...] } }

Per-repo fields:
  name           Repository name
  role           'parent' or 'child'
  dirty          Number of uncommitted changes
  commits        Number of commits ahead of parent branch
  syncStatus     null, 'pending', 'synced', or 'conflicted' (during sync)

Examples:
  grove workspace status feature-auth
  grove workspace status                    # auto-detect from cwd
  grove workspace status --json
`,

  sync: `
grove workspace sync <branch> [options]

  Fetch and merge upstream changes into the workspace. For grouped workspaces,
  syncs the parent repo first, then children.

  If a merge conflict occurs, sync stops and reports the conflicted repo and files.
  Resolve conflicts manually (edit files, git add, git commit), then re-run sync
  to resume. Already-synced repos are skipped on resume.

Arguments:
  <branch>       Branch name of the workspace to sync

Options:
  --verbose      Show per-repo sync details in text output
  --json         Output as JSON on success: { ok, data: { synced: [...], details: [...] } }
                 On conflict: { ok: false, error, data: { conflicted, files, resolved, pending } }

Conflict resolution workflow:
  1. grove workspace sync feature-auth          # fails with conflict
  2. cd $(grove workspace switch feature-auth)  # enter workspace
  3. [edit conflicted files, git add, git commit]
  4. grove workspace sync feature-auth          # resumes and completes

Examples:
  grove workspace sync feature-auth
  grove workspace sync feature-auth --verbose
  grove workspace sync feature-auth --json
`,

  close: `
grove workspace close <branch> --merge|--discard [options]

  Close a workspace by merging or discarding it.

  --merge mode:
    Fast-forward merges the workspace branch into each repo's parent branch,
    then removes worktrees and deletes branches. Requires:
    - No uncommitted changes in any repo
    - Sync must be complete (no active sync state)
    If fast-forward fails, run 'grove workspace sync' first.
    Processes children before parent.

  --discard mode:
    Force-removes all worktrees and branches regardless of state. Aborts any
    active merges, ignores errors, and always succeeds. Use this to clean up
    failed, conflicted, or abandoned workspaces.

Arguments:
  <branch>       Branch name of the workspace to close

Options:
  --merge        Merge workspace branches back (ff-only) and clean up
  --discard      Force-remove everything without merging
  --dry-run      (merge only) Show what would be merged without doing it
  --json         Output as JSON

Examples:
  grove workspace close feature-auth --merge
  grove workspace close feature-auth --merge --dry-run
  grove workspace close feature-auth --discard
  grove workspace close feature-auth --merge --json
`,

  describe: `
grove workspace describe <branch|id> [options]

  Output a complete environment descriptor for a workspace. Composes workspace
  state, environment state, and config into a single payload suitable for
  agent handoff.

  Returns: workspace info (repos, branch), services (URLs, ports), frontends,
  testing commands, and shell targets.

Arguments:
  <branch|id>    Branch name or workspace ID

Options:
  --json         Output as JSON: { ok, data: { workspace, services, frontends, testing, shell } }

Examples:
  grove workspace describe feature-auth
  grove workspace describe feature-auth --json
`,

  switch: `
grove workspace switch <branch> [options]

  Print the root path of a workspace. Designed for shell integration:

    cd $(grove workspace switch <branch>)

  Accepts either a branch name or workspace ID.

Arguments:
  <branch>       Branch name or workspace ID

Options:
  --json         Output as JSON: { ok, data: { path: "..." } }

Examples:
  grove workspace switch feature-auth
  cd $(grove workspace switch feature-auth)
  grove workspace switch feature-auth --json
`,
};

function printWorkspaceUsage(): void {
  console.log(`
grove workspace <command> [options]

  Manage isolated workspaces backed by git worktrees. Workspaces bundle one or
  more repos on a shared branch for coordinated multi-repo development.

  Simple workspaces: single repo, no config needed.
  Grouped workspaces: parent + child repos declared in .grove.yaml, all sharing
  one branch name with nested worktree layout.

Commands:
  create <branch> [--from <path>]                      Create a new workspace
  list                                                  List all workspaces
  status [<branch>]                                     Show workspace details
  sync <branch> [--verbose]                             Fetch and merge upstream
  close <branch> --merge|--discard [--dry-run]          Close a workspace
  switch <branch>                                       Print workspace root path
  describe <branch|id>                                  Environment descriptor
  help [<command>]                                      Show help for a command

Global options:
  --json         Machine-readable JSON output (envelope: { ok, data } or { ok, error })
  --help, -h     Show help (works on any subcommand)

Typical workflow:
  grove workspace create feature-auth        # create workspace
  cd $(grove workspace switch feature-auth)  # enter workspace
  [make changes, commit across repos]
  grove workspace sync feature-auth          # merge upstream changes
  grove workspace close feature-auth --merge # merge back and clean up

Environment variables:
  GROVE_WORKTREE_DIR   Base directory for worktrees (default: ~/worktrees/)
  GROVE_STATE_DIR      Directory for workspace state files (default: ~/.grove/workspaces/)

Configuration (.grove.yaml):
  workspace:
    repos:
      - path: public          # relative path to child repo (must be gitignored)
      - path: cloud

Run 'grove workspace help <command>' for detailed help on a specific command.
`);
}
