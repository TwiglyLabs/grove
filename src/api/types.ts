/**
 * Public types for the Grove library API.
 *
 * Re-exports from slices. No local type definitions remain.
 */

// Re-export identity types
export type { RepoId, WorkspaceId } from '../shared/identity.js';

// Re-export internal types used in the API surface
export type { WorkspaceStatus, SyncStatus } from '../workspace/types.js';
export type { TestPlatform, TestOptions, TestResult, FailureDetail, TestRunOptions } from '../testing/types.js';
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

// --- Satellite slice types (re-exported from owning slices) ---

export type { LogEntry } from '../logs/types.js';
export type { ShellCommand } from '../shell/types.js';
export type { SimulatorInfo } from '../simulator/types.js';
