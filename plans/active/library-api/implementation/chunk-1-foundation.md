# Chunk 1: Foundation + Identity + Migration

Foundation layer for the library API: error classes, event types, branded identity types, and lazy ID migration for the repo registry.

**Depends on:** Nothing (greenfield)
**Blocks:** Chunk 2 (all API modules depend on identity + errors)

---

## Task 1: Install nanoid dependency

**Steps:**
1. Run `npm install nanoid`
2. Verify it's added to package.json dependencies
3. Run `npm run build` to confirm no issues

**Verify:** `npm ls nanoid` shows installed version

---

## Task 2: Create `src/api/errors.ts` — typed error classes

All API errors extend a base `GroveError` with a `code` string for programmatic matching.

**Steps:**
1. Create `src/api/errors.ts` with these classes:

```typescript
// Base
export class GroveError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'GroveError';
  }
}

// Resource resolution
export class RepoNotFoundError extends GroveError {
  constructor(public repoId: string) {
    super('REPO_NOT_FOUND', `Repo not found: ${repoId}`);
  }
}

export class WorkspaceNotFoundError extends GroveError {
  constructor(public workspaceId: string) {
    super('WORKSPACE_NOT_FOUND', `Workspace not found: ${workspaceId}`);
  }
}

// Config
export class ConfigNotFoundError extends GroveError {
  constructor(path: string) {
    super('CONFIG_NOT_FOUND', `Config file not found: ${path}`);
  }
}

export class ConfigValidationError extends GroveError {
  constructor(public issues: unknown[]) {
    super('CONFIG_INVALID', `Config validation failed: ${issues.length} issue(s)`);
  }
}

// Workspace operations
export class BranchExistsError extends GroveError {
  constructor(branch: string) {
    super('BRANCH_EXISTS', `Branch already exists: ${branch}`);
  }
}

export class ConflictError extends GroveError {
  constructor(public repo: string, public files: string[]) {
    super('MERGE_CONFLICT', `Merge conflict in ${repo}: ${files.join(', ')}`);
  }
}

// Environment operations
export class HealthCheckFailedError extends GroveError {
  constructor(public service: string) {
    super('HEALTH_CHECK_FAILED', `Health check failed for ${service}`);
  }
}

export class DeploymentFailedError extends GroveError {
  constructor(message: string) {
    super('DEPLOYMENT_FAILED', message);
  }
}

export class EnvironmentNotRunningError extends GroveError {
  constructor() {
    super('ENVIRONMENT_NOT_RUNNING', 'No active environment found');
  }
}

export class PodNotFoundError extends GroveError {
  constructor(public service: string) {
    super('POD_NOT_FOUND', `Pod not found for service: ${service}`);
  }
}

// Streaming
export class LogStreamFailedError extends GroveError {
  constructor(message: string) {
    super('LOG_STREAM_FAILED', message);
  }
}

// Cancellation
export class AbortError extends GroveError {
  constructor() {
    super('ABORTED', 'Operation was aborted');
  }
}
```

2. Run `npm run build` to confirm compilation

**Verify:** `npm run build` succeeds

---

## Task 3: Create `src/api/events.ts` — event interface types

Callback-based event interfaces for all modules that support progress reporting.

**Steps:**
1. Create `src/api/events.ts`:

```typescript
import type { GroveError } from './errors.js';

export type EnvironmentPhase =
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
  | 'destroying';

export interface EnvironmentEvents {
  onPhase?(phase: EnvironmentPhase, message: string): void;
  onProgress?(step: string, detail?: string): void;
  onServiceStatus?(service: string, status: 'building' | 'deploying' | 'ready' | 'failed' | 'stopping' | 'stopped'): void;
  onHealthCheck?(target: string, healthy: boolean): void;
  onFileChange?(service: string, files: string[]): void;
  onRebuild?(service: string, phase: 'start' | 'complete' | 'error', error?: string): void;
  onError?(error: GroveError): void;
}

export interface WorkspaceEvents {
  onProgress?(step: string, repo?: string, detail?: string): void;
  onConflict?(repo: string, files: string[]): void;
  onError?(error: GroveError): void;
}

export interface TestEvents {
  onProgress?(phase: string, detail?: string): void;
  onTestComplete?(test: string, result: 'pass' | 'fail' | 'skip'): void;
  onError?(error: GroveError): void;
}
```

2. Run `npm run build` to confirm compilation

**Verify:** `npm run build` succeeds

---

## Task 4: Create `src/api/identity.ts` — branded types + resolution

Branded `RepoId` and `WorkspaceId` types plus helper functions for creating and validating IDs.

**Steps:**
1. Create `src/api/identity.ts`:

```typescript
import { nanoid } from 'nanoid';

// Branded types — consumers should not construct these directly
export type RepoId = string & { readonly __brand: 'RepoId' };
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };

// ID creation (internal use)
export function createRepoId(): RepoId {
  return `repo_${nanoid(12)}` as RepoId;
}

// Type guards
export function isRepoId(value: string): value is RepoId {
  return value.startsWith('repo_');
}

// Cast helpers (for internal use when reading from storage)
export function asRepoId(value: string): RepoId {
  if (!isRepoId(value)) {
    throw new Error(`Invalid RepoId: ${value}`);
  }
  return value;
}

export function asWorkspaceId(value: string): WorkspaceId {
  return value as WorkspaceId;
}
```

2. Run `npm run build` to confirm compilation

**Verify:** `npm run build` succeeds

---

## Task 5: Create `src/api/types.ts` — public API types

Re-export and define types that form the public API surface. Import existing types where possible, define new ones where the design specifies them.

**Steps:**
1. Create `src/api/types.ts`:

```typescript
import type { RepoId } from './identity.js';
import type { WorkspaceId } from './identity.js';
import type { WorkspaceStatus, SyncStatus } from '../workspace/types.js';

// Re-export identity types
export type { RepoId, WorkspaceId } from './identity.js';

// Re-export internal types used in the API surface
export type { WorkspaceStatus, SyncStatus } from '../workspace/types.js';
export type { TestPlatform, TestOptions, TestResult, FailureDetail } from '../types.js';
export type { GroveConfig, WorkspaceConfig } from '../config.js';

// --- Environment types ---

export interface UpOptions {
  frontend?: string;
  all?: boolean;
  signal?: AbortSignal;
}

export interface UpResult {
  state: import('../state.js').EnvironmentState;
  urls: Record<string, string>;
  ports: Record<string, number>;
  duration: number;
}

export interface DownResult {
  stopped: Array<{ name: string; pid: number; success: boolean }>;
  notRunning: string[];
}

export interface DestroyResult {
  stopped: DownResult;
  namespaceDeleted: boolean;
  stateRemoved: boolean;
}

export interface DashboardData {
  state: 'healthy' | 'degraded' | 'down' | 'unknown';
  namespace: string;
  services: Array<{
    name: string;
    status: 'running' | 'stopped' | 'error';
    port?: number;
    url?: string;
    pid?: number;
  }>;
  frontends: Array<{
    name: string;
    status: 'running' | 'stopped' | 'error';
    url?: string;
    pid?: number;
  }>;
  uptime?: number;
}

export interface WatchHandle {
  stop(): void;
  reload(service: string): void;
}

export interface PruneResult {
  deleted: string[];
  kept: string[];
}

// --- Repo types ---

export interface RepoEntry {
  id: RepoId;
  name: string;
  path: string;
  addedAt: string;
}

export interface RepoListEntry extends RepoEntry {
  exists: boolean;
  workspaceCount: number;
}

// --- Workspace types ---

export interface CreateOptions {
  from: RepoId;
  signal?: AbortSignal;
}

export interface CreateResult {
  id: WorkspaceId;
  root: string;
  branch: string;
  repos: string[];
}

export interface ListOptions {
  repo?: RepoId;
}

export interface WorkspaceListEntry {
  id: WorkspaceId;
  branch: string;
  status: WorkspaceStatus;
  age: string;
  root: string;
  missing: boolean;
}

export interface WorkspaceStatusResult {
  id: WorkspaceId;
  status: WorkspaceStatus;
  branch: string;
  repos: Array<{
    name: string;
    role: 'parent' | 'child';
    dirty: number;
    commits: number;
    syncStatus: SyncStatus | null;
  }>;
}

export interface SyncOptions {
  signal?: AbortSignal;
}

export interface SyncResult {
  synced: string[];
  details: Array<{ name: string; status: string }>;
}

export type CloseMode = 'merge' | 'discard';

export interface CloseOptions {
  dryRun?: boolean;
  signal?: AbortSignal;
}

export interface DryRunResult {
  repos: Array<{ name: string; commits: number }>;
}

export interface CloseResult {
  branch: string;
  mode: CloseMode;
}

// --- Request types ---

export interface RequestOptions {
  body: string;
  description?: string;
  sourceRepo?: RepoId;
}

export interface RequestResult {
  file: string;
  worktree: string;
  branch: string;
  source: string | null;
  target: string;
}

// --- Testing types ---

export interface TestRunOptions {
  platform: import('../types.js').TestPlatform;
  suite?: string;
  flow?: string[];
  file?: string;
  grep?: string;
  useDev?: boolean;
  excludeAi?: boolean;
  ai?: boolean;
  noEnsure?: boolean;
  timeout?: number;
  verbose?: boolean;
  signal?: AbortSignal;
}

// --- Logs types ---

export interface LogEntry {
  service: string;
  type: 'port-forward' | 'frontend';
  content: string;
}

// --- Shell types ---

export interface ShellCommand {
  command: string;
  args: string[];
  namespace: string;
}

// --- Simulator types ---

export interface SimulatorInfo {
  udid: string;
  name: string;
  status: 'booted' | 'shutdown' | 'unknown';
  basedOn: string;
}
```

2. Run `npm run build` to confirm compilation

**Verify:** `npm run build` succeeds

---

## Task 6: Add `id` field to repo registry + lazy migration

Update `src/repo/types.ts` to include an optional `id` field, and update `src/repo/state.ts` to generate IDs lazily on read for entries that lack them.

**Steps:**
1. Edit `src/repo/types.ts`:
   - Add `id: z.string().optional()` to `RepoEntry` schema

2. Edit `src/repo/state.ts`:
   - Import `createRepoId` from `../api/identity.js`
   - Modify `readRegistry()`:
     - After parsing, check if any entry is missing an `id`
     - If so, assign `createRepoId()` to each missing entry
     - Write the updated registry back to disk atomically (using `writeRegistry`)
     - Return the registry with all IDs populated
   - Make `writeRegistry` accessible from `readRegistry` (it's already in the same file)
   - Make `readRegistry` async (since it may need to write)

3. Update all callers of `readRegistry()` to `await` it:
   - `src/repo/list.ts` — `listRepos()` becomes async
   - `src/commands/repo.ts` — already async command handlers
   - Any other callers (search for `readRegistry` usage)

4. Run `npm run build` to confirm compilation
5. Run `npm run test` to confirm existing tests still pass (may need minor updates for async)

**Verify:** `npm run build` and `npm run test` both pass

---

## Task 7: Create `src/api/index.ts` — barrel export

The main entry point for the library API. Re-exports all public types, errors, and (for now) identity helpers. Module-level API functions will be added in Chunk 2+.

**Steps:**
1. Create `src/api/index.ts`:

```typescript
// Error classes
export {
  GroveError,
  RepoNotFoundError,
  WorkspaceNotFoundError,
  ConfigNotFoundError,
  ConfigValidationError,
  BranchExistsError,
  ConflictError,
  HealthCheckFailedError,
  DeploymentFailedError,
  EnvironmentNotRunningError,
  PodNotFoundError,
  LogStreamFailedError,
  AbortError,
} from './errors.js';

// Event interfaces
export type {
  EnvironmentPhase,
  EnvironmentEvents,
  WorkspaceEvents,
  TestEvents,
} from './events.js';

// Identity
export type { RepoId, WorkspaceId } from './identity.js';
export { isRepoId, asRepoId, asWorkspaceId } from './identity.js';

// Public types
export type {
  // Environment
  UpOptions,
  UpResult,
  DownResult,
  DestroyResult,
  DashboardData,
  WatchHandle,
  PruneResult,
  // Repo
  RepoEntry,
  RepoListEntry,
  // Workspace
  CreateOptions,
  CreateResult,
  ListOptions,
  WorkspaceListEntry,
  WorkspaceStatusResult,
  SyncOptions,
  SyncResult,
  CloseMode,
  CloseOptions,
  DryRunResult,
  CloseResult,
  // Request
  RequestOptions,
  RequestResult,
  // Testing
  TestRunOptions,
  // Logs
  LogEntry,
  // Shell
  ShellCommand,
  // Simulator
  SimulatorInfo,
  // Re-exported internals
  WorkspaceStatus,
  SyncStatus,
  TestPlatform,
  TestOptions,
  TestResult,
  GroveConfig,
  WorkspaceConfig,
} from './types.js';
```

2. Run `npm run build`

**Verify:** `npm run build` succeeds

---

## Task 8: Update `package.json` exports

Add the `exports` field so consumers can `import { ... } from '@twiglylabs/grove'` to get the library API.

**Steps:**
1. Edit `package.json`:
   - Change `"main"` to `"./dist/api/index.js"`
   - Add `"types": "./dist/api/index.d.ts"`
   - Add `"exports"` field:
     ```json
     "exports": {
       ".": {
         "import": "./dist/api/index.js",
         "types": "./dist/api/index.d.ts"
       },
       "./cli": {
         "import": "./dist/index.js"
       }
     }
     ```
   - Keep `"bin"` unchanged

2. Run `npm run build`

**Verify:** `npm run build` succeeds

---

## Task 9: Write unit tests for Chunk 1

Test identity helpers, error classes, and lazy ID migration.

**Steps:**
1. Create `src/api/identity.test.ts`:
   - `createRepoId()` returns string starting with `repo_`
   - `isRepoId()` returns true for valid repo IDs, false for others
   - `asRepoId()` throws for invalid IDs
   - `asWorkspaceId()` returns the value cast to WorkspaceId

2. Create `src/api/errors.test.ts`:
   - Each error class has the correct `code` property
   - Each error is an instance of `GroveError` and `Error`
   - Properties like `repoId`, `service`, `files` are set correctly

3. Update/create test for lazy migration in `src/repo/state.test.ts`:
   - Write a registry with entries missing `id` field
   - Call `readRegistry()`
   - Verify all entries now have `id` fields starting with `repo_`
   - Verify the file on disk was updated with IDs
   - Verify a second read returns the same IDs (no re-generation)

4. Run `npm run test`

**Verify:** All tests pass
