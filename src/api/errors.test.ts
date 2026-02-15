import { describe, it, expect } from 'vitest';
import {
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

describe('GroveError', () => {
  it('has code and message', () => {
    const err = new GroveError('TEST_CODE', 'test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err.name).toBe('GroveError');
  });

  it('is an instance of Error', () => {
    const err = new GroveError('X', 'y');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('error classes', () => {
  it('RepoNotFoundError', () => {
    const err = new RepoNotFoundError('repo_abc123');
    expect(err.code).toBe('REPO_NOT_FOUND');
    expect(err.repoId).toBe('repo_abc123');
    expect(err.message).toContain('repo_abc123');
    expect(err).toBeInstanceOf(GroveError);
    expect(err).toBeInstanceOf(Error);
  });

  it('WorkspaceNotFoundError', () => {
    const err = new WorkspaceNotFoundError('myproject-feature');
    expect(err.code).toBe('WORKSPACE_NOT_FOUND');
    expect(err.workspaceId).toBe('myproject-feature');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('ConfigNotFoundError', () => {
    const err = new ConfigNotFoundError('/path/to/.grove.yaml');
    expect(err.code).toBe('CONFIG_NOT_FOUND');
    expect(err.message).toContain('/path/to/.grove.yaml');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('ConfigValidationError', () => {
    const issues = [{ path: ['project', 'name'], message: 'Required' }];
    const err = new ConfigValidationError(issues);
    expect(err.code).toBe('CONFIG_INVALID');
    expect(err.issues).toBe(issues);
    expect(err.message).toContain('1 issue');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('BranchExistsError', () => {
    const err = new BranchExistsError('feature-x');
    expect(err.code).toBe('BRANCH_EXISTS');
    expect(err.message).toContain('feature-x');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('ConflictError', () => {
    const err = new ConflictError('myrepo', ['file1.ts', 'file2.ts']);
    expect(err.code).toBe('MERGE_CONFLICT');
    expect(err.repo).toBe('myrepo');
    expect(err.files).toEqual(['file1.ts', 'file2.ts']);
    expect(err.message).toContain('myrepo');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('HealthCheckFailedError', () => {
    const err = new HealthCheckFailedError('api');
    expect(err.code).toBe('HEALTH_CHECK_FAILED');
    expect(err.service).toBe('api');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('DeploymentFailedError', () => {
    const err = new DeploymentFailedError('helm upgrade failed');
    expect(err.code).toBe('DEPLOYMENT_FAILED');
    expect(err.message).toBe('helm upgrade failed');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('EnvironmentNotRunningError', () => {
    const err = new EnvironmentNotRunningError();
    expect(err.code).toBe('ENVIRONMENT_NOT_RUNNING');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('PodNotFoundError', () => {
    const err = new PodNotFoundError('worker');
    expect(err.code).toBe('POD_NOT_FOUND');
    expect(err.service).toBe('worker');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('LogStreamFailedError', () => {
    const err = new LogStreamFailedError('connection reset');
    expect(err.code).toBe('LOG_STREAM_FAILED');
    expect(err.message).toBe('connection reset');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('AbortError', () => {
    const err = new AbortError();
    expect(err.code).toBe('ABORTED');
    expect(err).toBeInstanceOf(GroveError);
  });
});
