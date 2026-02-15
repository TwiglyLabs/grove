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
  TestPlatform,
  TestOptions,
  TestResult,
  GroveConfig,
  WorkspaceConfig,
} from './types.js';
