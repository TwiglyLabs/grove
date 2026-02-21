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
  PreflightFailedError,
  PortForwardFailedError,
  FrontendStartFailedError,
  BuildFailedError,
  ImageLoadFailedError,
  NamespaceDeletionFailedError,
  StateWriteFailedError,
  StateCorruptedError,
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

  it('preserves prototype chain for subclasses', () => {
    const err = new BuildFailedError('svc');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GroveError);
    expect(err).toBeInstanceOf(BuildFailedError);
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

  it('ConfigValidationError includes field paths in message', () => {
    const issues = [{ path: ['project', 'name'], message: 'Required' }];
    const err = new ConfigValidationError(issues);
    expect(err.code).toBe('CONFIG_INVALID');
    expect(err.issues).toBe(issues);
    expect(err.message).toContain('project.name');
    expect(err.message).toContain('Required');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('ConfigValidationError formats multiple issues', () => {
    const issues = [
      { path: ['services', 0, 'portForward', 'remotePort'], message: 'Expected number' },
      { path: ['helm', 'chart'], message: 'Required' },
    ];
    const err = new ConfigValidationError(issues);
    expect(err.message).toContain('services.0.portForward.remotePort: Expected number');
    expect(err.message).toContain('helm.chart: Required');
  });

  it('ConfigValidationError handles missing path', () => {
    const issues = [{ message: 'Invalid input' }];
    const err = new ConfigValidationError(issues);
    expect(err.message).toContain('(root): Invalid input');
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

  it('PreflightFailedError', () => {
    const checks = [
      { name: 'docker', message: 'not running' },
      { name: 'kubectl' },
    ];
    const err = new PreflightFailedError(checks);
    expect(err.code).toBe('PREFLIGHT_FAILED');
    expect(err.checks).toBe(checks);
    expect(err.message).toContain('docker');
    expect(err.message).toContain('not running');
    expect(err.message).toContain('kubectl');
    expect(err.message).toContain('not available');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('PortForwardFailedError', () => {
    const err = new PortForwardFailedError('api', 3000);
    expect(err.code).toBe('PORT_FORWARD_FAILED');
    expect(err.service).toBe('api');
    expect(err.port).toBe(3000);
    expect(err.message).toContain('api');
    expect(err.message).toContain('3000');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('FrontendStartFailedError', () => {
    const err = new FrontendStartFailedError('web');
    expect(err.code).toBe('FRONTEND_START_FAILED');
    expect(err.frontend).toBe('web');
    expect(err.message).toContain('web');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('FrontendStartFailedError with cause', () => {
    const err = new FrontendStartFailedError('web', 'process exited immediately');
    expect(err.message).toContain('process exited immediately');
  });

  it('BuildFailedError', () => {
    const err = new BuildFailedError('api');
    expect(err.code).toBe('BUILD_FAILED');
    expect(err.service).toBe('api');
    expect(err.message).toContain('api');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('BuildFailedError with cause', () => {
    const err = new BuildFailedError('api', 'docker timeout');
    expect(err.message).toContain('docker timeout');
  });

  it('ImageLoadFailedError', () => {
    const err = new ImageLoadFailedError('api', 'kind');
    expect(err.code).toBe('IMAGE_LOAD_FAILED');
    expect(err.service).toBe('api');
    expect(err.providerType).toBe('kind');
    expect(err.message).toContain('api');
    expect(err.message).toContain('kind');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('ImageLoadFailedError with cause', () => {
    const err = new ImageLoadFailedError('api', 'k3s', 'image not found');
    expect(err.message).toContain('image not found');
  });

  it('NamespaceDeletionFailedError', () => {
    const err = new NamespaceDeletionFailedError('test-ns');
    expect(err.code).toBe('NAMESPACE_DELETION_FAILED');
    expect(err.namespace).toBe('test-ns');
    expect(err.message).toContain('test-ns');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('NamespaceDeletionFailedError with cause', () => {
    const err = new NamespaceDeletionFailedError('test-ns', 'timeout');
    expect(err.message).toContain('timeout');
  });

  it('StateWriteFailedError', () => {
    const err = new StateWriteFailedError();
    expect(err.code).toBe('STATE_WRITE_FAILED');
    expect(err).toBeInstanceOf(GroveError);
  });

  it('StateWriteFailedError with cause', () => {
    const err = new StateWriteFailedError('disk full');
    expect(err.message).toContain('disk full');
  });

  it('StateCorruptedError', () => {
    const err = new StateCorruptedError('/tmp/state.json');
    expect(err.code).toBe('STATE_CORRUPTED');
    expect(err.filePath).toBe('/tmp/state.json');
    expect(err.message).toContain('/tmp/state.json');
    expect(err).toBeInstanceOf(GroveError);
  });
});
