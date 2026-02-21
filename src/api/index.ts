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
  TestEvents,
} from './events.js';

// Identity
export type { RepoId, WorkspaceId } from '../shared/identity.js';
export { isRepoId, asRepoId, asWorkspaceId } from '../shared/identity.js';

// Repo types (re-exported from repo slice)
export type { RepoEntry, RepoListEntry } from '../repo/types.js';

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
  TestPlatform,
  TestOptions,
  TestResult,
  GroveConfig,
  WorkspaceConfig,
} from './types.js';

// API modules (namespace imports)
import * as repo from '../repo/api.js';
import * as config from '../shared/config.js';
import * as workspace from './workspace.js';
import * as request from '../request/api.js';
import * as environment from '../environment/api.js';
import * as testing from './testing.js';
import * as logs from './logs.js';
import * as shell from './shell.js';
import * as simulator from './simulator.js';

export { repo, config, workspace, request, environment, testing, logs, shell, simulator };
