# Grove Library API Design

## Motivation

Grove is currently a CLI-only tool. All functionality is accessed through `grove <command>` invocations that parse `process.argv`, print to stdout/stderr, and exit with status codes. An Electron desktop app needs to consume all of Grove's functionality programmatically: structured data in, structured data out, with rich progress reporting and event-driven updates.

The CLI's output layer (`output.ts`) mixes data and presentation — `printDashboard` both assembles dashboard data and renders it with chalk. The command layer parses string args, calls internal functions, then routes output to either `console.log` (human) or `jsonSuccess`/`jsonError` (machine). The actual logic already lives in well-separated modules (`workspace/`, `repo/`, `controller.ts`, `state.ts`, etc.), but there's no clean public entry point.

This plan designs a library API that:
1. Exports all grove functionality as typed async functions
2. Returns structured data (never prints, never exits)
3. Supports progress/event callbacks for long-running operations
4. Re-uses the existing internal modules as-is
5. Lets the CLI become a thin consumer of the same API
6. Uses grove-managed IDs as the primary way to reference repos and workspaces

---

## Design Principles

### 1. Data out, never side effects
Every API function returns a typed result. No `console.log`, no `process.exit`, no `process.exitCode`. Errors throw typed exceptions. The consumer decides what to render.

### 2. Progress as events, not print statements
Long-running operations (up, sync, watch, test) accept an optional event emitter or callback. The CLI replaces its `printInfo`/`printSuccess` calls with event emissions. The Electron app can wire these into its UI.

### 3. One API surface, two entry points
- `@twiglylabs/grove` — the library (new `src/api/index.ts`)
- `@twiglylabs/grove/cli` — the CLI binary (existing `src/index.ts`, refactored to consume the API)

### 4. No breaking changes to internals
The internal modules stay as they are. The API layer is a new thin facade that calls the same functions the CLI calls today, but returns results instead of printing.

### 5. Config is explicit, not ambient
The CLI auto-discovers config from cwd via `git rev-parse`, resolves the path to a `RepoId` via `repo.findByPath()`, then calls the API with the ID. The library API only accepts `RepoId` — no implicit cwd dependency, no raw paths.

### 6. ID-based resource addressing
Repos and workspaces are referenced by grove-managed IDs, not filesystem paths or branch names. IDs are stable, opaque strings assigned by grove on creation and discoverable via list operations. The consumer stores the ID and passes it back — no ambient cwd or path resolution required.

---

## Identity Model

Grove manages two kinds of addressable resources: repos and workspaces. Both get stable IDs assigned on creation, stored in grove's internal state, and returned to the consumer. **All API functions accept IDs, never raw paths.** The CLI resolves paths to IDs before calling the API.

### Repo IDs

```typescript
// Opaque string type — consumers should not parse or construct these
type RepoId = string & { readonly __brand: 'RepoId' }
```

**Format:** `repo_` prefix + 12-character nanoid (e.g., `repo_V1StGXR8_Z5`). Generated once on `repo.add()`, stored in `~/.grove/repos.json`, never changes.

A repo gets its ID when registered via `repo.add()`. The ID is stored in the global repo registry (`~/.grove/repos.json`). All subsequent operations that need a repo accept `RepoId`.

**Lazy migration:** The existing registry has entries without IDs. When the registry is read and an entry lacks an `id` field, the reader generates one, writes the updated registry back to disk, and returns the entry with its new ID. This is transparent — no migration command needed, no user action required. First read after upgrade backfills all IDs atomically.

The Electron app workflow:
1. User adds a repo → `repo.add('/path/to/repo')` → returns `{ id: 'repo_V1StGXR8_Z5', ... }`
2. App stores `repo_V1StGXR8_Z5` in its state
3. All future calls use the ID: `config.load('repo_V1StGXR8_Z5')`, `environment.up('repo_V1StGXR8_Z5', ...)`

The CLI workflow:
1. User runs `grove up` in a repo directory
2. CLI resolves cwd → repo root via `git rev-parse`
3. CLI calls `repo.findByPath(root)` → gets `RepoId` (auto-registers if not found, see repo module)
4. CLI calls `environment.up(repoId, ...)`

### Workspace IDs

```typescript
type WorkspaceId = string & { readonly __brand: 'WorkspaceId' }
```

Workspaces already have IDs in the current internal state (format: `{projectName}-{branch}`). The API makes these first-class: `workspace.create()` returns the ID, `workspace.list()` includes IDs, all workspace operations accept `WorkspaceId`.

### Resolution

The API layer resolves IDs internally:
- `RepoId` → look up path in repo registry → load config from that path
- `WorkspaceId` → look up workspace state by ID → resolve branch, repos, paths

This keeps the consumer decoupled from filesystem layout. The Electron app never needs to know or care where repos live on disk — it just holds IDs.

### No raw paths in the API

Every function that references a repo accepts `RepoId`, not `RepoId | string`. The CLI is responsible for resolving paths to IDs via `repo.findByPath()` before calling any API function. This eliminates runtime ambiguity between IDs and paths, and ensures every API call goes through the same resolution path.

---

## API Surface

### Module: `grove/config`

```typescript
// Load and validate .grove.yaml for a registered repo
function load(repo: RepoId): GroveConfig

// Load just the workspace section (returns null if missing)
function loadWorkspaceConfig(repo: RepoId): WorkspaceConfig | null

// Resolve a repo ID to its filesystem path (useful for advanced consumers)
function resolveRepoPath(repo: RepoId): string

// All config types re-exported
type GroveConfig, Service, Frontend, HealthCheck, ...
```

The API resolves the repo's filesystem path from the registry, then loads `.grove.yaml` from that path. All functions accept `RepoId` — no raw paths. The CLI resolves cwd to a `RepoId` via `repo.findByPath()` before calling these functions.

**CLI today:** `loadConfig()` uses `git rev-parse` to find root. Library version requires a `RepoId` — no implicit cwd.

---

### Module: `grove/environment`

Manages the local K8s development environment (the `up`/`down`/`destroy`/`status`/`watch`/`reload`/`prune` lifecycle). **Single-repo scope:** each function operates on one repo's environment. Multi-repo workspaces run `up()` per repo — the workspace module coordinates this (see `grove/workspace`).

```typescript
interface EnvironmentEvents {
  // Phase progression
  onPhase?(phase: EnvironmentPhase, message: string): void
  // Per-step progress within a phase
  onProgress?(step: string, detail?: string): void
  // Service-level status changes
  onServiceStatus?(service: string, status: 'building' | 'deploying' | 'ready' | 'failed' | 'stopping' | 'stopped'): void
  // Health check results
  onHealthCheck?(target: string, healthy: boolean): void
  // File change detected (watch mode)
  onFileChange?(service: string, files: string[]): void
  // Rebuild triggered (watch mode)
  onRebuild?(service: string, phase: 'start' | 'complete' | 'error', error?: string): void
  // Non-fatal error during an event-driven operation
  onError?(error: GroveError): void
}

type EnvironmentPhase =
  | 'cluster'
  | 'bootstrap'
  | 'state'
  | 'namespace'
  | 'build'
  | 'deploy'
  | 'port-forward'
  | 'frontend'
  | 'health-check'
  | 'stopping'
  | 'destroying'

interface UpOptions {
  frontend?: string
  all?: boolean
  signal?: AbortSignal
}

interface UpResult {
  state: EnvironmentState
  urls: Record<string, string>
  ports: Record<string, number>
  duration: number
}

// Start environment — returns when fully healthy
function up(repo: RepoId, options?: UpOptions, events?: EnvironmentEvents): Promise<UpResult>

// Stop all processes, keep namespace
function down(repo: RepoId, options?: { signal?: AbortSignal }, events?: EnvironmentEvents): Promise<DownResult>

interface DownResult {
  stopped: Array<{ name: string; pid: number; success: boolean }>
  notRunning: string[]
}

// Stop processes + delete namespace + remove state
function destroy(repo: RepoId, options?: { signal?: AbortSignal }, events?: EnvironmentEvents): Promise<DestroyResult>

interface DestroyResult {
  stopped: DownResult
  namespaceDeleted: boolean
  stateRemoved: boolean
}

// Get current environment status (structured, not rendered)
function status(repo: RepoId): Promise<DashboardData | null>

interface DashboardData {
  state: 'healthy' | 'degraded' | 'down' | 'unknown'
  namespace: string
  services: Array<{
    name: string
    status: 'running' | 'stopped' | 'error'
    port?: number
    url?: string
    pid?: number
  }>
  frontends: Array<{
    name: string
    status: 'running' | 'stopped' | 'error'
    url?: string
    pid?: number
  }>
  uptime?: number
}

// Start file watcher — returns a controller handle
function watch(repo: RepoId, events?: EnvironmentEvents): Promise<WatchHandle>

interface WatchHandle {
  stop(): void
  // Programmatic trigger — runs the same rebuild as standalone reload()
  // Difference: uses the active watcher's chokidar instance for debouncing
  reload(service: string): void
}

// Trigger a single service rebuild without an active watch session
// Performs a full helm upgrade + port-forward restart for the target service
function reload(repo: RepoId, service: string, events?: EnvironmentEvents): Promise<void>

// Clean up orphaned namespaces matching this repo's project prefix
// "Orphaned" = namespace exists in k8s but no corresponding workspace state file
function prune(repo: RepoId): Promise<PruneResult>

interface PruneResult {
  deleted: string[]    // namespace names
  kept: string[]
}
```

**Error behavior during event-driven operations:** When a non-fatal error occurs mid-operation (e.g., one service fails to build but others continue), `onError` fires and the operation continues. When a fatal error occurs (e.g., cluster unreachable), the promise rejects with a typed `GroveError`. The `onServiceStatus(service, 'failed')` callback fires before rejection when a service failure causes the overall operation to fail.

**Cancellation:** `up()`, `down()`, and `destroy()` accept `AbortSignal` via options. When aborted, the operation stops at the next step boundary, cleans up partial state, and rejects with an `AbortError`. The Electron app wires this to a Cancel button. `destroy()` cancellation stops process killing but does NOT cancel namespace deletion if it's already started (partial namespace state is worse than full deletion).

**`down()` and `destroy()` events:** These operations emit `onServiceStatus(service, 'stopping')` and `onServiceStatus(service, 'stopped')` as each process is killed, and `onProgress` for namespace deletion during destroy. This lets the Electron app show per-service teardown progress instead of a blind spinner.

**`prune()` scope:** Takes `RepoId` because it needs the project name from `.grove.yaml` to find matching namespaces (`{project.name}-*`). It's not truly global — it only cleans namespaces for that project.

**`WatchHandle.reload()` vs standalone `reload()`:** Both trigger the same rebuild (helm upgrade + port-forward restart). The difference: `WatchHandle.reload()` coordinates with the active watcher's debounce logic to avoid duplicate rebuilds if a file change arrives simultaneously. Standalone `reload()` is fire-and-forget when no watcher is running.

**What the library unlocks vs CLI:**
- `up()` returns structured `UpResult` with URLs/ports/duration — the Electron app can render a live dashboard
- `EnvironmentEvents` callbacks let the Electron app show phase-by-phase progress, per-service build status, live health checks — the CLI just prints lines sequentially
- `watch()` returns a `WatchHandle` instead of blocking forever — the Electron app controls the lifecycle
- `reload()` works standalone without needing an active watch session
- `status()` returns `DashboardData` directly — the Electron app renders its own UI, not a terminal table
- `down()`/`destroy()` return per-process success/failure with progress events — the Electron app can show which processes are stopping and which failed

---

### Module: `grove/workspace`

Manages multi-repo workspaces backed by git worktrees.

```typescript
interface WorkspaceEvents {
  onProgress?(step: string, repo?: string, detail?: string): void
  onConflict?(repo: string, files: string[]): void
  onError?(error: GroveError): void
}

interface CreateOptions {
  from: RepoId        // parent repo — child repos auto-discovered from its .grove.yaml workspace.repos
  signal?: AbortSignal
}

interface CreateResult {
  id: WorkspaceId
  root: string
  branch: string
  repos: string[]     // repo names (parent + children)
}

// Create a workspace with git worktrees for the parent repo and any child repos
// declared in the parent's .grove.yaml `workspace.repos` section.
// Simple workspaces (no workspace.repos config) create a single worktree.
// Grouped workspaces create worktrees for parent + all children on the same branch.
function create(branch: string, options: CreateOptions, events?: WorkspaceEvents): Promise<CreateResult>

interface ListOptions {
  repo?: RepoId       // filter to workspaces sourced from this repo (optional)
}

interface WorkspaceListEntry {
  id: WorkspaceId
  branch: string
  status: WorkspaceStatus
  age: string
  root: string
  missing: boolean    // worktree path no longer exists on disk
}

function list(options?: ListOptions): Promise<WorkspaceListEntry[]>

interface WorkspaceStatusResult {
  id: WorkspaceId
  status: WorkspaceStatus
  branch: string
  repos: Array<{
    name: string
    role: 'parent' | 'child'
    dirty: number
    commits: number
    syncStatus: SyncStatus | null
  }>
}

function getStatus(workspace: WorkspaceId): Promise<WorkspaceStatusResult>

interface SyncOptions {
  signal?: AbortSignal
}

interface SyncResult {
  synced: string[]
  details: Array<{ name: string; status: string }>
}

function sync(workspace: WorkspaceId, options?: SyncOptions, events?: WorkspaceEvents): Promise<SyncResult>

type CloseMode = 'merge' | 'discard'

interface CloseOptions {
  dryRun?: boolean
  signal?: AbortSignal
}

interface DryRunResult {
  repos: Array<{ name: string; commits: number }>
}

interface CloseResult {
  branch: string
  mode: CloseMode
}

// Close a workspace — merge commits to parent branch or discard all changes.
// If a previous close-merge failed (workspace status is 'failed'), passing
// mode='discard' recovers by force-removing worktrees and cleaning up state.
// Sync also auto-recovers from 'failed' status by resetting to 'active'.
function close(workspace: WorkspaceId, mode: CloseMode, options?: CloseOptions, events?: WorkspaceEvents): Promise<CloseResult | DryRunResult>

// Resolve workspace root path — for shell integration (`cd $(grove workspace switch <branch>)`)
// Pure lookup, no side effects. Returns the filesystem path to the workspace root.
function resolvePath(workspace: WorkspaceId): string

// Direct state access (for advanced use cases)
function readState(workspace: WorkspaceId): WorkspaceState | null
```

**Recovery:** No separate recovery function. Failed workspaces are recovered through existing operations:
- `close(ws, 'discard')` — always succeeds, even on failed workspaces (force-removes worktrees + state)
- `sync(ws)` — auto-resets a 'failed' workspace to 'active' and resumes syncing
- `create()` — if a workspace with the same branch exists in 'failed' status, automatically cleans up the failed state before creating

**What the library unlocks vs CLI:**
- `sync()` with `WorkspaceEvents.onConflict` — the Electron app can show conflicted files inline, open a merge editor, then resume
- `create()` returns structured `CreateResult` with `WorkspaceId` — Electron app stores the ID and uses it for all subsequent operations
- `list(repo?)` filters by repo — Electron app can show "workspaces for this repo" without client-side filtering
- `getStatus()` returns typed objects — Electron app renders its own workspace dashboard
- `close()` dry-run returns per-repo commit counts — Electron app can show a confirmation dialog
- `close()` with events reports per-repo progress during merge/discard

---

### Module: `grove/repo`

Manages the global repo registry. The registry is the source of truth for `RepoId` → path mapping.

```typescript
interface RepoEntry {
  id: RepoId
  name: string
  path: string
  addedAt: string
}

interface RepoListEntry extends RepoEntry {
  exists: boolean          // path still exists on disk
  workspaceCount: number
}

function add(path: string): Promise<RepoEntry>
function remove(repo: RepoId): Promise<void>
function get(repo: RepoId): RepoEntry | null
function list(): RepoListEntry[]

// Resolve a filesystem path to a RepoId — the CLI's primary entry point.
// Looks up the registry for an entry whose path matches (after resolving symlinks).
// Returns null if the path isn't registered.
function findByPath(path: string): RepoEntry | null
```

`path` is required in `add()` (no cwd default). `get()` is new — lets consumers look up a single repo by ID without listing all. `findByPath()` is new — the CLI calls this to resolve cwd to a `RepoId` before calling any other API function.

**Lazy ID migration:** The current `repos.json` has entries without `id` fields. When `readRegistry()` loads the file and finds entries missing IDs, it generates a `repo_` + nanoid for each, writes the updated registry back atomically (same proper-lockfile pattern as workspace state), and returns entries with IDs. This is a one-time, transparent operation — no migration command needed.

**What the library unlocks vs CLI:**
- `list()` returns enriched entries with workspace counts — Electron app can render a repo dashboard with workspace badges
- `add()` returns the created entry with its `RepoId` — Electron app stores the ID and uses it everywhere
- `get()` enables quick lookups — Electron app can resolve a repo's name/path from its stored ID

---

### Module: `grove/request`

Cross-repo plan requests.

```typescript
interface RequestOptions {
  body: string
  description?: string
  sourceRepo?: RepoId  // auto-detected in CLI, explicit here
}

interface RequestResult {
  file: string
  worktree: string
  branch: string
  source: string | null
  target: string
}

function createRequest(
  targetRepo: RepoId,
  planName: string,
  options: RequestOptions
): Promise<RequestResult>
```

**What the library unlocks vs CLI:**
- No file I/O for body (`--body-file` is a CLI convenience; library takes a string)
- Repos referenced by ID, not name strings

---

### Module: `grove/testing`

Test execution and result management.

```typescript
interface TestEvents {
  onProgress?(phase: string, detail?: string): void
  onTestComplete?(test: string, result: 'pass' | 'fail' | 'skip'): void
  onError?(error: GroveError): void
}

interface TestRunOptions extends TestOptions {
  signal?: AbortSignal
}

// TestOptions and TestResult already exist as types — re-export them
function runTests(repo: RepoId, options: TestRunOptions, events?: TestEvents): Promise<TestResult>

// Test history access (the CLI doesn't expose this at all)
function getTestHistory(repo: RepoId, platform?: TestPlatform): Promise<TestResult[]>
```

**What the library unlocks vs CLI:**
- `TestEvents.onTestComplete` — Electron app can show a live test runner with per-test status
- `getTestHistory()` — Electron app can render a test history dashboard (this data exists on disk but the CLI has no command to read it)
- No exit codes — result is in `TestResult.run.result`, consumer decides what to do

---

### Module: `grove/logs`

Log access.

```typescript
interface LogEntry {
  service: string
  type: 'port-forward' | 'frontend'
  content: string
}

// Read file-based logs
function readLogs(repo: RepoId, service: string): Promise<LogEntry | null>

// Stream pod logs — returns an async iterator
// Resolves namespace internally from repo's environment state
function streamPodLogs(
  repo: RepoId,
  service: string,
  options?: { tail?: number }
): AsyncIterable<string>
```

`streamPodLogs` takes `RepoId` instead of a raw namespace string. The API resolves the active namespace from the repo's environment state internally. The consumer never needs to know or extract the namespace.

**Error contract for `streamPodLogs`:**
- If the environment isn't running (no state file), throws `EnvironmentNotRunningError` before yielding any lines.
- If the pod doesn't exist, throws `PodNotFoundError` before yielding any lines.
- If the kubectl connection drops mid-stream, the iterator throws a `GroveError` with code `LOG_STREAM_FAILED`. The consumer's `for await` loop catches it naturally.
- The iterator completes (returns, doesn't throw) if the pod terminates normally.

**What the library unlocks vs CLI:**
- `streamPodLogs()` returns an async iterator — Electron app can render a live log viewer that the user can scroll, filter, and search
- `readLogs()` returns content as a string — no need to shell out to `cat`

---

### Module: `grove/shell`

Interactive shell access.

```typescript
// Returns the kubectl exec command parts for the consumer to spawn
function getShellCommand(
  repo: RepoId,
  service: string
): Promise<{ command: string; args: string[]; namespace: string }>
```

**What the library unlocks vs CLI:**
- Returns command parts instead of spawning — the Electron app can open its own terminal emulator (xterm.js) with the right command
- Electron owns the PTY, not grove

---

### Module: `grove/simulator`

iOS simulator management.

```typescript
interface SimulatorInfo {
  udid: string
  name: string
  status: 'booted' | 'shutdown' | 'unknown'
  basedOn: string
}

function cloneSimulator(repo: RepoId): Promise<SimulatorInfo>
function bootSimulator(udid: string): Promise<void>
function shutdownSimulator(udid: string): Promise<void>
function deleteSimulator(udid: string): Promise<void>
function installApp(repo: RepoId, udid: string): Promise<string>  // returns install path
function connectMetro(repo: RepoId, udid: string): Promise<void>
function listSimulators(prefix: string): Promise<SimulatorInfo[]>
```

Note: `connectMetro` no longer takes an `EnvironmentState` parameter. The API resolves the environment state internally from the repo's active state. This keeps `EnvironmentState` as an internal type.

---

## Event System Design

The library uses a simple callback-based event system rather than Node EventEmitter. This is intentional:

1. **Type safety** — callbacks are fully typed at the call site, no string event names
2. **Tree-shakeable** — unused event interfaces don't add weight
3. **Electron-friendly** — callbacks work naturally across the IPC bridge (Electron main process -> renderer)
4. **No inheritance** — consumers don't need to extend or instantiate anything

```typescript
// Consumer provides only the callbacks they care about
const result = await grove.environment.up(repoId, { all: true }, {
  onPhase(phase, message) {
    ipcRenderer.send('grove:phase', { phase, message })
  },
  onServiceStatus(service, status) {
    ipcRenderer.send('grove:service', { service, status })
  },
  onError(error) {
    ipcRenderer.send('grove:error', { code: error.code, message: error.message })
  }
})
```

For streaming/long-lived operations (watch, pod logs), the API returns handles or async iterables that the consumer controls:

```typescript
// Watch returns a handle — consumer controls lifecycle
const watcher = await grove.environment.watch(repoId, {
  onFileChange(service, files) { /* update UI */ },
  onRebuild(service, phase) { /* update UI */ }
})

// Later...
watcher.stop()

// Pod logs return an async iterable — consumer controls consumption
for await (const line of grove.logs.streamPodLogs(repoId, service)) {
  appendToLogView(line)
}
```

### Error contract during event-driven operations

All event interfaces include an optional `onError` callback. The contract:

- **Non-fatal errors** (one service fails, others continue): `onError` fires, operation continues. Example: during `up()`, service-x fails to build but service-y succeeds.
- **Fatal errors** (operation cannot continue): `onError` fires, then the promise rejects with the same `GroveError`. Example: cluster is unreachable.
- **Service-specific failures**: `onServiceStatus(service, 'failed')` fires before `onError` when a service failure is the cause.
- **If `onError` is not provided**: non-fatal errors are silently swallowed (the consumer opted out). Fatal errors still reject the promise.

### Backpressure note

Callbacks are fire-and-forget — the API does not wait for the callback to return before continuing. For high-frequency events (file watcher changes), consumers that need throttling should debounce in their callback handler. `streamPodLogs` uses async iteration, which naturally provides backpressure (the API only produces the next line when the consumer pulls it).

### Concurrency

The API does not serialize calls internally. Concurrent calls to the same resource are the consumer's responsibility to coordinate. Specific guarantees:

- **Read-only operations** (`status()`, `list()`, `get()`, `readState()`, `readLogs()`): safe to call concurrently.
- **Write operations** (`up()`, `down()`, `sync()`, `close()`): calling two write operations on the same resource concurrently is undefined behavior. The consumer must ensure only one write operation is in flight per resource at a time.
- **Cross-resource operations**: safe to call concurrently (e.g., `up(repoA)` and `up(repoB)` in parallel).
- **State files**: workspace state uses `proper-lockfile` for atomic writes, so concurrent reads during a write will see either the old or new state, never a partial write. The repo registry uses the same pattern.

The Electron app should disable action buttons while an operation is in flight (e.g., grey out "Sync" while sync is running). This is a UI concern, not an API concern.

---

## Error Handling

The library uses typed error classes instead of exit codes or `jsonError` envelopes.

```typescript
// Base error
class GroveError extends Error {
  code: string
}

// Resource resolution
class RepoNotFoundError extends GroveError { code = 'REPO_NOT_FOUND'; repoId: RepoId }
class WorkspaceNotFoundError extends GroveError { code = 'WORKSPACE_NOT_FOUND'; workspaceId: WorkspaceId }

// Config
class ConfigNotFoundError extends GroveError { code = 'CONFIG_NOT_FOUND' }
class ConfigValidationError extends GroveError { code = 'CONFIG_INVALID'; issues: ZodIssue[] }

// Workspace operations
class BranchExistsError extends GroveError { code = 'BRANCH_EXISTS' }
class ConflictError extends GroveError { code = 'MERGE_CONFLICT'; repo: string; files: string[] }

// Environment operations
class HealthCheckFailedError extends GroveError { code = 'HEALTH_CHECK_FAILED'; service: string }
class DeploymentFailedError extends GroveError { code = 'DEPLOYMENT_FAILED' }
class EnvironmentNotRunningError extends GroveError { code = 'ENVIRONMENT_NOT_RUNNING' }
class PodNotFoundError extends GroveError { code = 'POD_NOT_FOUND'; service: string }

// Streaming
class LogStreamFailedError extends GroveError { code = 'LOG_STREAM_FAILED' }

// Cancellation
class AbortError extends GroveError { code = 'ABORTED' }
```

The Electron app can match on `error.code` for programmatic handling, and use `error.message` for display. The CLI maps these to exit codes and `printError`.

Notable additions vs the original design:
- `RepoNotFoundError` — thrown when a `RepoId` isn't in the registry
- `AbortError` — thrown when an operation is cancelled via `AbortSignal`
- `EnvironmentNotRunningError` — thrown by `logs`, `shell`, and `simulator` when no active environment state exists
- `PodNotFoundError` — thrown when a service's pod can't be found in the namespace
- `LogStreamFailedError` — thrown when a kubectl log stream drops mid-stream
- `NotInRepoError` removed — the library API doesn't auto-detect repos, so this error doesn't apply. The CLI can throw its own version in its arg-parsing layer.

---

## Package Structure

```
src/
  api/                    # NEW — library API surface
    index.ts              # Main barrel export
    identity.ts           # RepoId/WorkspaceId types + resolution helpers
    environment.ts        # up/down/destroy/status/watch/reload/prune
    workspace.ts          # create/list/status/sync/close/resolvePath
    repo.ts               # add/remove/get/list/findByPath
    config.ts             # load/loadWorkspaceConfig/resolveRepoPath
    request.ts            # createRequest
    testing.ts            # runTests/getTestHistory
    logs.ts               # readLogs/streamPodLogs
    shell.ts              # getShellCommand
    simulator.ts          # simulator operations
    errors.ts             # Typed error classes
    events.ts             # Event interface types
    types.ts              # DashboardData, EnvironmentPhase, and other public types
  commands/               # EXISTING — CLI command handlers (refactored to use api/)
  workspace/              # EXISTING — internal workspace logic (unchanged)
  repo/                   # EXISTING — internal repo logic (unchanged)
  testing/                # EXISTING — internal test logic (unchanged)
  ...                     # other existing internals (unchanged)
  index.ts                # EXISTING — CLI entry point (kept as bin)
```

### package.json exports

```json
{
  "main": "./dist/api/index.js",
  "types": "./dist/api/index.d.ts",
  "bin": {
    "grove": "./dist/index.js"
  },
  "exports": {
    ".": {
      "import": "./dist/api/index.js",
      "types": "./dist/api/index.d.ts"
    },
    "./cli": {
      "import": "./dist/index.js"
    }
  }
}
```

**Breaking change:** The current `main` field points to `./dist/index.js` (the CLI entry point). This changes it to `./dist/api/index.js`. Anyone doing `require('@twiglylabs/grove')` today would get the CLI module — after the change they get the library API. Since no external consumers import the package this way today (it's only used as a CLI binary via `bin`), this is safe. The `bin` field is unchanged.

This lets consumers do:
```typescript
import { environment, workspace, repo } from '@twiglylabs/grove'
```

### CLI `--json` mode

The CLI's existing `--json` mode (via `jsonSuccess`/`jsonError`) remains for shell scripting consumers who invoke `grove` as a subprocess. The library API replaces it for programmatic consumers (Electron, Node scripts). Once the CLI is refactored to consume the API (Chunk 4), `--json` mode simply serializes the API's return values instead of maintaining its own formatting logic.

---

## Testing Strategy

The library API is the long-term public interface. The CLI may eventually be retired. Tests should reflect this — **the API layer gets the most thorough test coverage**, not the CLI.

### Integration tests (priority)

Integration tests exercise the full API surface end-to-end: call the public function, let it flow through internal modules, verify the returned result. These are the primary safety net.

```
tests/
  integration/
    repo.test.ts          # add/remove/get/list with real filesystem
    workspace.test.ts     # create/list/status/sync/close with real git repos
    config.test.ts        # load from registered repo, load from path, validation errors
    environment.test.ts   # up/down/status/reload (requires k8s — may need test fixtures or mocks at the k8s boundary)
    testing.test.ts       # runTests/getTestHistory with test fixtures
    request.test.ts       # createRequest with real filesystem
    logs.test.ts          # readLogs with fixture files, streamPodLogs with mock kubectl
    shell.test.ts         # getShellCommand returns correct command parts
    simulator.test.ts     # simulator operations (may need mocks for xcrun)
    identity.test.ts      # RepoId/WorkspaceId resolution, error on invalid IDs
```

Each integration test:
- Sets up real filesystem state (temp dirs, git repos, `.grove.yaml` files)
- Calls the public API function
- Asserts on the returned typed result (not console output)
- Verifies events fire in the correct order (for event-driven operations)
- Verifies typed errors are thrown for error cases

For operations that require external infrastructure (k8s cluster, iOS simulator), tests mock at the infrastructure boundary (kubectl commands, xcrun commands) rather than mocking internal modules. This ensures the API layer and internal modules are tested together.

### Unit tests

Unit tests cover the API layer's own logic — ID resolution, error mapping, event dispatch, config resolution from RepoId. They mock internal modules to test the API facade in isolation.

```
tests/
  unit/
    api/
      identity.test.ts   # RepoId resolution, registry lookups
      errors.test.ts      # Error class construction, code matching
      environment.test.ts # Event dispatch logic, AbortSignal handling
      workspace.test.ts   # ID-based dispatch, dry-run branching
```

### Test configuration

Integration tests use the existing `vitest` setup. Add a dedicated config for API integration tests that may need longer timeouts (environment operations):

```typescript
// vitest.api.config.ts
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30_000,
  }
})
```

### Relationship to existing tests

The codebase has 27 existing test files:
- **`src/**/*.test.ts`** — unit tests for internal modules (config, state, output, commands, workspace/*, repo/*, testing/*, simulator)
- **`test/e2e/`** — end-to-end tests for repo and workspace operations

These tests continue running unchanged through Chunks 1-3 (the API is additive). During Chunk 4 (CLI refactor), existing command tests (`src/commands/*.test.ts`) may need updates as command handlers are refactored to call the API layer instead of internals directly. The internal module tests (`src/workspace/*.test.ts`, `src/repo/*.test.ts`, etc.) remain untouched — they test the same internal functions the API calls.

**No existing tests are deleted.** API-level integration tests supplement, not replace, the existing suite. The e2e tests serve as a regression safety net during the refactor.

### What we don't test at this layer

- CLI arg parsing and output formatting — tested separately in existing CLI-specific tests (`src/commands/*.test.ts`)
- Internal module logic — already covered by existing unit tests
- Chalk rendering, terminal formatting — presentation concerns, not API concerns

---

## Implementation Strategy

### Chunk 1: Foundation + Identity + Migration
- Create `src/api/errors.ts` with typed error classes
- Create `src/api/events.ts` with event interface types
- Create `src/api/identity.ts` with `RepoId`/`WorkspaceId` branded types and resolution helpers
- Create `src/api/types.ts` with `DashboardData` and other public types
- Create `src/api/index.ts` barrel export
- Update `package.json` exports
- Add lazy migration to `repo/state.ts`: generate `repo_` + nanoid IDs for existing entries on read, write back atomically
- Add `id` field to `RepoEntry` type in `repo/types.ts`
- **Tests:** Unit tests for identity resolution, error construction, lazy ID migration

### Chunk 2: Config-free APIs (repo, workspace, request, config)
- `src/api/repo.ts` — wraps `repo/state.ts` and `repo/list.ts`, adds `get()`, `findByPath()`, assigns `RepoId` on `add()`
- `src/api/workspace.ts` — wraps `workspace/*.ts`, all operations accept `WorkspaceId`, `list()` accepts optional repo filter
- `src/api/request.ts` — extract logic from `commands/request.ts`, accepts `RepoId`
- `src/api/config.ts` — wraps `config.ts`, accepts `RepoId` only (resolves path from registry internally)
- **Tests:** Integration tests for repo CRUD (including `findByPath`), workspace lifecycle, config loading by ID

### Chunk 3: Config-dependent APIs (environment, testing, logs, shell, simulator)
- `src/api/environment.ts` — wraps `controller.ts` + `state.ts`, adds events (including on `down`/`destroy`) + `AbortSignal` + `reload()` + `DashboardData` return
- `src/api/testing.ts` — wraps `testing/test-runner.ts` with events
- `src/api/logs.ts` — wraps log reading + kubectl streaming, resolves namespace from repo state, implements error contract for `streamPodLogs`
- `src/api/shell.ts` — returns command parts, resolves namespace from repo state, throws `EnvironmentNotRunningError` when appropriate
- `src/api/simulator.ts` — wraps simulator operations, resolves `EnvironmentState` internally
- **Tests:** Integration tests for each module (mocking at k8s/xcrun boundary where needed)

### Chunk 4: CLI refactor
- Refactor each `commands/*.ts` to consume `api/*.ts` instead of calling internals directly
- CLI becomes: parse args → resolve repo from cwd via `repo.findByPath()` → call API with `RepoId` → format output (print or JSON)
- `--json` mode serializes API return values
- Validates that the API surface is complete — if the CLI can't do something through the API, the API is missing something
- Update existing command tests (`src/commands/*.test.ts`) as needed

**Hard dependency:** Chunk 4 must fully cover a command before Chunk 5 can clean up the internals that command uses.

**Per-command refactor order** (dependencies flow top-down):
1. `repo.ts` — foundation; `findByPath()` needed by all other commands
2. `status.ts` — read-only, low risk, validates `DashboardData` type
3. `logs.ts`, `shell.ts` — read-only, simple wrappers
4. `up.ts` — most complex; validates event system end-to-end
5. `down.ts`, `destroy.ts`, `reload.ts`, `prune.ts` — environment lifecycle
6. `watch.ts` — long-lived, validates `WatchHandle`
7. `workspace.ts` — all subcommands (create, list, status, sync, close, switch)
8. `test.ts` — validates test events
9. `request.ts` — standalone, no dependencies on other commands

### Chunk 5: Internal cleanup
- Remove `console.log`/`process.exit` calls from internal modules that the API now wraps
- Replace `printInfo`/`printSuccess` calls in `controller.ts` and other internals with event emissions
- The internal modules should be pure logic; presentation belongs in the CLI command layer
- Only touch modules that are fully wrapped by Chunk 3 **and** whose CLI commands are refactored in Chunk 4

**Module cleanup dependency matrix:**

| Internal module | Wrapped by (Chunk 3) | CLI refactored (Chunk 4) | Safe to clean up |
|---|---|---|---|
| `controller.ts` | `api/environment.ts` | `commands/up.ts` | After up.ts refactored |
| `state.ts` | `api/environment.ts` | `commands/status.ts`, `commands/down.ts`, `commands/destroy.ts` | After all three refactored |
| `watcher.ts` | `api/environment.ts` | `commands/watch.ts` | After watch.ts refactored |
| `prune.ts` | `api/environment.ts` | `commands/prune.ts` | After prune.ts refactored |
| `workspace/*.ts` | `api/workspace.ts` | `commands/workspace.ts` | After workspace.ts refactored |
| `repo/*.ts` | `api/repo.ts` | `commands/repo.ts` | After repo.ts refactored |
| `testing/*.ts` | `api/testing.ts` | `commands/test.ts` | After test.ts refactored |
| `simulator/*.ts` | `api/simulator.ts` | `commands/shell.ts` (partially) | After shell.ts refactored |
| `output.ts` | N/A (CLI-only) | All commands | Last — after all commands refactored |

---

## What the Library API Unlocks (Summary)

| Capability | CLI limitation | Library advantage |
|---|---|---|
| Resource identity | Branch names, cwd paths | Stable grove-managed IDs |
| Progress reporting | Sequential print lines | Typed phase/step/service callbacks |
| Error handling | Exit codes + stderr | Typed error classes with structured data |
| Cancellation | Ctrl-C kills the process | AbortSignal for graceful cancellation |
| Watch lifecycle | Blocks process forever | Returns handle with stop()/reload() |
| Standalone reload | Only via watch or file touch | Direct `reload(repo, service)` call |
| Log streaming | Spawns kubectl, inherits stdio | Async iterator, consumer owns rendering |
| Shell access | Spawns interactive process | Returns command parts, consumer owns PTY |
| Test execution | Exit codes 0-3 | Result object with typed enum |
| Dashboard data | Chalk-rendered terminal table | Structured `DashboardData` object |
| Config discovery | Implicit cwd + git rev-parse | Explicit repo ID (CLI resolves path → ID) |
| Test history | Not exposed at all | New `getTestHistory()` function |
| Conflict resolution | Print + re-run CLI | Event callback + resume |
