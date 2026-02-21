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
} from './shared/errors.js';

// Identity
export type { RepoId, WorkspaceId } from './shared/identity.js';
export { isRepoId, asRepoId, asWorkspaceId } from './shared/identity.js';

// Event interfaces (from slices)
export type { EnvironmentPhase, EnvironmentEvents, ClusterProvider, ClusterType } from './environment/types.js';
export type { WorkspaceEvents } from './workspace/types.js';
export type { TestEvents } from './testing/types.js';

// Repo types
export type { RepoEntry, RepoListEntry } from './repo/types.js';

// Environment types
export type {
  UpOptions,
  UpResult,
  DownResult,
  DestroyResult,
  DashboardData,
  WatchHandle,
  PruneOptions,
  PruneResult,
  StoppedProcessEntry,
  DanglingPortEntry,
  StaleStateFileEntry,
  OrphanedWorktreeEntry,
  OrphanedNamespaceEntry,
} from './environment/types.js';

// Workspace types
export type {
  WorkspaceStatus,
  SyncStatus,
  SetupResult,
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
  EnvironmentDescriptor,
  ServiceDescriptor,
  FrontendDescriptor,
  TestingDescriptor,
  ShellDescriptor,
} from './workspace/types.js';

// Testing types
export type {
  TestRunOptions,
  TestPlatform,
  TestOptions,
  TestResult,
  FailureDetail,
} from './testing/types.js';

// Logs types
export type { LogEntry } from './logs/types.js';

// Shell types
export type { ShellCommand } from './shell/types.js';

// Simulator types
export type { SimulatorInfo } from './simulator/types.js';

// Config types
export type { GroveConfig, WorkspaceConfig } from './config.js';

// API modules (namespace imports from slices)
import * as repo from './repo/api.js';
import * as config from './shared/config.js';
import * as workspace from './workspace/api.js';
import * as environment from './environment/api.js';
import * as testing from './testing/api.js';
import * as logs from './logs/api.js';
import * as shell from './shell/api.js';
import * as simulator from './simulator/api.js';

export { repo, config, workspace, environment, testing, logs, shell, simulator };
