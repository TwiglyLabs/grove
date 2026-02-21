/**
 * Public types for the Grove library API.
 *
 * Re-exports existing internal types where possible, defines new types
 * for API-specific concepts (results, options, handles).
 */

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

// --- Workspace types (re-exported from workspace slice) ---

export type {
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
} from '../workspace/types.js';

// --- Request types (re-exported from request slice) ---

export type { RequestOptions, RequestResult } from '../request/types.js';

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
