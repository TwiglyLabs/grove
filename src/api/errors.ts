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
  constructor(public issues: unknown[]) {
    super('CONFIG_INVALID', `Config validation failed: ${issues.length} issue(s)`);
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
