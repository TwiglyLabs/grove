/**
 * Typed error classes for the Grove library API.
 *
 * All errors extend GroveError with a `code` string for programmatic matching.
 * Consumers match on `error.code` and use `error.message` for display.
 */

export class GroveError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'GroveError';
  }
}

// --- Resource resolution ---

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

// --- Config ---

export class ConfigNotFoundError extends GroveError {
  constructor(path: string) {
    super('CONFIG_NOT_FOUND', `Config file not found: ${path}`);
  }
}

export class ConfigValidationError extends GroveError {
  constructor(public issues: Array<{ path?: (string | number)[]; message?: string }>) {
    const details = issues
      .map(i => {
        const path = i.path?.join('.') || '(root)';
        return `${path}: ${i.message || 'invalid'}`;
      })
      .join(', ');
    super('CONFIG_INVALID', `Config validation failed: ${details}`);
  }
}

// --- Workspace operations ---

export class BranchExistsError extends GroveError {
  constructor(branch: string) {
    super('BRANCH_EXISTS', `Branch already exists: ${branch}`);
  }
}

export class ConflictError extends GroveError {
  constructor(
    public repo: string,
    public files: string[],
  ) {
    super('MERGE_CONFLICT', `Merge conflict in ${repo}: ${files.join(', ')}`);
  }
}

// --- Environment operations ---

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

// --- Streaming ---

export class LogStreamFailedError extends GroveError {
  constructor(message: string) {
    super('LOG_STREAM_FAILED', message);
  }
}

// --- Cancellation ---

export class AbortError extends GroveError {
  constructor() {
    super('ABORTED', 'Operation was aborted');
  }
}

// --- Hooks ---

export class HookFailedError extends GroveError {
  constructor(public hookName: string, cause?: unknown) {
    super('HOOK_FAILED', `Hook "${hookName}" failed${cause ? `: ${cause}` : ''}`);
  }
}

// --- Preflight ---

export class PreflightFailedError extends GroveError {
  constructor(public checks: Array<{ name: string; message?: string }>) {
    const failed = checks.map((c) => `  - ${c.name}: ${c.message || 'not available'}`).join('\n');
    super('PREFLIGHT_FAILED', `Preflight checks failed:\n${failed}`);
  }
}

export class PortForwardFailedError extends GroveError {
  constructor(public service: string, public port: number) {
    super('PORT_FORWARD_FAILED', `Port forward failed for ${service} on port ${port}`);
  }
}

// --- Frontend ---

export class FrontendStartFailedError extends GroveError {
  constructor(public frontend: string, cause?: unknown) {
    super('FRONTEND_START_FAILED', `Frontend ${frontend} failed to start${cause ? `: ${cause}` : ''}`);
  }
}

// --- Build pipeline ---

export class BuildFailedError extends GroveError {
  constructor(public service: string, cause?: unknown) {
    super('BUILD_FAILED', `Failed to build ${service}${cause ? `: ${cause}` : ''}`);
  }
}

export class RegistryPullFailedError extends GroveError {
  constructor(public service: string, cause?: unknown) {
    super('REGISTRY_PULL_FAILED', `Failed to pull ${service} from registry${cause ? `: ${cause}` : ''}`);
  }
}

export class ImageLoadFailedError extends GroveError {
  constructor(public service: string, public providerType: string, cause?: unknown) {
    super('IMAGE_LOAD_FAILED', `Failed to load ${service} to ${providerType}${cause ? `: ${cause}` : ''}`);
  }
}

// --- Namespace ---

export class NamespaceDeletionFailedError extends GroveError {
  constructor(public namespace: string, cause?: unknown) {
    super('NAMESPACE_DELETION_FAILED', `Failed to delete namespace ${namespace}${cause ? `: ${cause}` : ''}`);
  }
}

// --- State ---

export class PortRangeExhaustedError extends GroveError {
  constructor() {
    super('PORT_RANGE_EXHAUSTED', 'No available port block below 65535. Run `grove prune` to free stale port allocations.');
  }
}

export class StateWriteFailedError extends GroveError {
  constructor(cause?: unknown) {
    super('STATE_WRITE_FAILED', `Failed to write state${cause ? `: ${cause}` : ''}`);
  }
}

export class StateCorruptedError extends GroveError {
  constructor(public filePath: string) {
    super('STATE_CORRUPTED', `State file corrupted: ${filePath}`);
  }
}
