# CLI Reference

All commands support `--help` / `-h` for inline help.

## Global Options

| Option | Description |
|--------|-------------|
| `--json` | Machine-readable JSON output. Envelope: `{ ok, data }` on success or `{ ok: false, error }` on failure. Supported on all `repo` and `workspace` subcommands. |

---

## Environment Commands

These commands operate on the current repo. Run them from inside a git repository that has a `.grove.yaml`.

### `grove up`

Start the development environment. Provisions the cluster and namespace if they do not exist, builds and loads Docker images, deploys the Helm chart, forwards ports, and starts configured frontend dev servers.

```
grove up [options]

Options:
  --frontend <name>   Start a specific frontend only (skip backend services)
  --all               Start all configured frontends
```

Examples:
```bash
grove up                       # full environment
grove up --frontend webapp     # webapp dev server only
grove up --all                 # all frontends, skip backend
```

### `grove down`

Stop all running processes (port forwards, frontend dev servers, watchers) without deleting the Kubernetes namespace or Helm release.

```
grove down
```

### `grove destroy`

Stop all processes and delete the Kubernetes namespace and Helm release. State file is removed. Use this to fully tear down an environment.

```
grove destroy
```

### `grove status`

Show the current environment state: health (healthy / degraded / error), namespace, uptime, per-service status, port forwards, and service URLs.

```
grove status
```

### `grove watch`

Watch configured `watchPaths` for file changes and trigger image rebuilds and rolling restarts automatically. Requires the environment to be running (`grove up` first).

```
grove watch
```

Press `Ctrl+C` to stop watching.

### `grove prune`

Scan for and clean up orphaned resources: dead processes, dangling port allocations, stale state files for missing worktrees, orphaned worktrees, and orphaned Kubernetes namespaces.

```
grove prune [options]

Options:
  --dry-run    Preview what would be cleaned without making any changes
```

Examples:
```bash
grove prune            # clean orphaned resources
grove prune --dry-run  # preview only
```

### `grove reload <service>`

Trigger a manual rebuild and rolling restart for a specific service without waiting for a file change. Requires the environment to be running.

```
grove reload <service>

Arguments:
  <service>    Name of the service to reload (must have a build config)
```

Examples:
```bash
grove reload api
```

---

## Service Commands

### `grove logs <service>`

Stream logs for a named service. By default streams from the local log file. Use `--pod` to stream directly from the Kubernetes pod via `kubectl`.

```
grove logs <service> [options]

Arguments:
  <service>    Service name as declared in .grove.yaml

Options:
  --pod        Stream from the kubectl pod logs instead of the log file
```

Examples:
```bash
grove logs api
grove logs api --pod
```

### `grove shell [service]`

Open an interactive shell in a running service pod via `kubectl exec`. If no service is given, opens a shell in the first available pod.

```
grove shell [service]

Arguments:
  [service]    Service name (optional, defaults to first available pod)
```

Examples:
```bash
grove shell
grove shell api
```

### `grove test <platform>`

Run tests against the active environment. Parses results and writes history to `.grove/test-history/`.

```
grove test <platform> [additional args...]

Arguments:
  <platform>   One of: mobile, webapp, api
```

Examples:
```bash
grove test api
grove test webapp
grove test mobile
```

---

## Repo Commands

Manage the global repo registry. Repos registered here are available as workspace sources and appear in the Canopy dashboard.

### `grove repo add [path]`

Register a git repository. Defaults to the current directory.

```
grove repo add [<path>] [options]

Arguments:
  [<path>]     Absolute or relative path to the repo root (default: current directory)

Options:
  --json       JSON output: { ok, data: { name, path, alreadyRegistered } }
```

Examples:
```bash
grove repo add                        # register current directory
grove repo add /path/to/myapp         # register specific path
grove repo add --json                 # machine-readable output
```

### `grove repo remove <name>`

Unregister a repo by name.

```
grove repo remove <name> [options]

Arguments:
  <name>    Repository name as shown in `grove repo list`

Options:
  --json    JSON output: { ok, data: { name } }
```

Examples:
```bash
grove repo remove myapp
```

### `grove repo list`

List all registered repos with their path, existence status, and workspace count.

```
grove repo list [options]

Options:
  --json    JSON output: { ok, data: { repos: [...] } }
```

Examples:
```bash
grove repo list
grove repo list --json
```

---

## Workspace Commands

Manage isolated workspaces backed by git worktrees. A workspace creates a branch across one or more repos and sets up a nested worktree layout for coordinated multi-repo development.

**Simple workspaces** involve a single repo and require no config.

**Grouped workspaces** involve a parent repo plus child repos declared in `.grove.yaml` under `workspace.repos`. All repos share a single branch name.

### `grove workspace create <branch>`

Create a new workspace. Runs preflight checks before any git mutations. If any check fails, nothing is modified. If worktree creation fails partway through, all changes are rolled back.

```
grove workspace create <branch> [options]

Arguments:
  <branch>         Branch name (must not already exist)

Options:
  --from <path>    Source repo path (default: current working directory)
  --json           JSON output: { ok, data: { id, root, branch, repos } }
```

Examples:
```bash
grove workspace create feature-auth
grove workspace create feature-auth --from /path/to/repo
```

### `grove workspace list`

List all workspaces. Workspaces whose root directory no longer exists on disk are flagged `[MISSING]`.

```
grove workspace list [options]

Options:
  --json    JSON output: { ok, data: { workspaces: [...] } }
```

Output columns: `id`, `branch`, `status`, `age`, `root`

Status values: `creating`, `active`, `closing`, `failed`

### `grove workspace status [branch]`

Show detailed status for a workspace. If `<branch>` is omitted, auto-detects from the current working directory.

```
grove workspace status [<branch>] [options]

Arguments:
  [<branch>]    Branch name or workspace ID (optional if inside a workspace)

Options:
  --json        JSON output: { ok, data: { id, status, branch, repos: [...] } }
```

Per-repo fields: `name`, `role` (parent/child), `dirty` (uncommitted changes), `commits` (ahead of parent branch), `syncStatus`.

### `grove workspace sync <branch>`

Fetch and merge upstream changes into the workspace. For grouped workspaces, syncs the parent repo first, then children.

If a merge conflict occurs, sync stops and reports the conflicted repo and files. Resolve manually then re-run to resume. Already-synced repos are skipped on resume.

```
grove workspace sync <branch> [options]

Arguments:
  <branch>      Branch name of the workspace to sync

Options:
  --verbose     Show per-repo sync details
  --json        JSON output on success: { ok, data: { synced, details } }
                On conflict: { ok: false, error, data: { conflicted, files, resolved, pending } }
```

Conflict resolution workflow:
```bash
grove workspace sync feature-auth          # fails with conflict
cd $(grove workspace switch feature-auth)  # enter workspace
# edit conflicted files, git add, git commit
grove workspace sync feature-auth          # resumes and completes
```

### `grove workspace close <branch> --merge|--discard`

Close a workspace by merging or discarding it.

**`--merge` mode:** Fast-forward merges the workspace branch into each repo's parent branch, then removes worktrees and deletes branches. Requires no uncommitted changes and a completed sync. Processes children before parent.

**`--discard` mode:** Force-removes all worktrees and branches without merging. Ignores errors. Use to clean up failed, conflicted, or abandoned workspaces.

```
grove workspace close <branch> --merge|--discard [options]

Arguments:
  <branch>     Branch name of the workspace to close

Options:
  --merge      Merge workspace branches back (fast-forward only) and clean up
  --discard    Force-remove everything without merging
  --dry-run    (merge only) Show what would be merged without doing it
  --json       JSON output
```

Examples:
```bash
grove workspace close feature-auth --merge
grove workspace close feature-auth --merge --dry-run
grove workspace close feature-auth --discard
```

### `grove workspace switch <branch>`

Print the root path of a workspace. Designed for shell integration.

```
grove workspace switch <branch> [options]

Arguments:
  <branch>    Branch name or workspace ID

Options:
  --json      JSON output: { ok, data: { path: "..." } }
```

Examples:
```bash
cd $(grove workspace switch feature-auth)
```

### `grove workspace describe <branch|id>`

Output a complete environment descriptor for a workspace. Composes workspace state, environment state, and config into a single payload — suitable for agent handoff.

Returns: workspace info (repos, branch), services (URLs, ports), frontends, testing commands, and shell targets.

```
grove workspace describe <branch|id> [options]

Arguments:
  <branch|id>    Branch name or workspace ID

Options:
  --json         JSON output: { ok, data: { workspace, services, frontends, testing, shell } }
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GROVE_WORKTREE_DIR` | `~/worktrees/` | Base directory for workspace worktrees |
| `GROVE_STATE_DIR` | `~/.grove/workspaces/` | Directory for workspace state files |

---

## Typical Workflows

### Start a feature

```bash
grove workspace create feature-auth
cd $(grove workspace switch feature-auth)
grove up
grove status
```

### Work with a running environment

```bash
grove watch          # auto-rebuild on file changes
grove logs api       # stream service logs
grove shell api      # open a shell in the pod
grove test api       # run API tests
```

### Sync and close when done

```bash
grove workspace sync feature-auth
grove workspace close feature-auth --merge
```
