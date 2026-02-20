/**
 * Public types for the Grove library API.
 *
 * Re-exports existing internal types where possible, defines new types
 * for API-specific concepts (results, options, handles).
 */

import type { RepoId, WorkspaceId } from '../shared/identity.js';

// Re-export identity types
export type { RepoId, WorkspaceId } from '../shared/identity.js';

// Re-export internal types used in the API surface
export type { WorkspaceStatus, SyncStatus } from '../workspace/types.js';
export type { TestPlatform, TestOptions, TestResult, FailureDetail } from '../types.js';
export type { GroveConfig, WorkspaceConfig } from '../config.js';

// --- Environment types (re-exported from environment slice) ---

export type {
  UpOptions,
  UpResult,
  DownResult,
  DestroyResult,
  DashboardData,
  WatchHandle,
  PruneResult,
} from '../environment/types.js';

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
  status: string;
  age: string;
  root: string;
  missing: boolean;
}

export interface WorkspaceStatusResult {
  id: WorkspaceId;
  status: string;
  branch: string;
  repos: Array<{
    name: string;
    role: 'parent' | 'child';
    dirty: number;
    commits: number;
    syncStatus: string | null;
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
