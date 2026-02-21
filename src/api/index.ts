/**
 * Grove Library API — public entry point.
 *
 * Usage:
 *   import { environment, workspace, repo } from '@twiglylabs/grove'
 */

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
} from '../shared/errors.js';

// Event interfaces
export type {
  EnvironmentPhase,
  EnvironmentEvents,
  WorkspaceEvents,
} from './events.js';
export type { TestEvents } from '../testing/types.js';

// Identity
export type { RepoId, WorkspaceId } from '../shared/identity.js';
export { isRepoId, asRepoId, asWorkspaceId } from '../shared/identity.js';

// Repo types (re-exported from repo slice)
export type { RepoEntry, RepoListEntry } from '../repo/types.js';

// Public types — from slices
export type {
  // Environment
  UpOptions,
  UpResult,
  DownResult,
  DestroyResult,
  DashboardData,
  WatchHandle,
  PruneResult,
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
} from './types.js';

// Testing types (from testing slice)
export type {
  TestRunOptions,
  TestPlatform,
  TestOptions,
  TestResult,
  TestEvents as TestEventsType,
} from '../testing/types.js';

// Logs types (from logs slice)
export type { LogEntry } from '../logs/types.js';

// Shell types (from shell slice)
export type { ShellCommand } from '../shell/types.js';

// Simulator types (from simulator slice)
export type { SimulatorInfo } from '../simulator/types.js';

// Config types
export type { GroveConfig, WorkspaceConfig } from '../config.js';

// API modules (namespace imports — from slices)
import * as repo from '../repo/api.js';
import * as config from '../shared/config.js';
import * as workspace from '../workspace/api.js';
import * as request from '../request/api.js';
import * as environment from '../environment/api.js';
import * as testing from '../testing/api.js';
import * as logs from '../logs/api.js';
import * as shell from '../shell/api.js';
import * as simulator from '../simulator/api.js';

export { repo, config, workspace, request, environment, testing, logs, shell, simulator };
