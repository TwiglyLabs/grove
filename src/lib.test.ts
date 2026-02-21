import { describe, it, expect } from 'vitest';
import * as lib from './lib.js';

describe('lib (public API barrel)', () => {
  describe('namespace exports', () => {
    it.each([
      'repo',
      'config',
      'workspace',
      'request',
      'environment',
      'testing',
      'logs',
      'shell',
      'simulator',
    ])('exports %s namespace', (name) => {
      expect(lib).toHaveProperty(name);
      expect(typeof (lib as any)[name]).toBe('object');
    });
  });

  describe('error class exports', () => {
    it.each([
      'GroveError',
      'RepoNotFoundError',
      'WorkspaceNotFoundError',
      'ConfigNotFoundError',
      'ConfigValidationError',
      'BranchExistsError',
      'ConflictError',
      'HealthCheckFailedError',
      'DeploymentFailedError',
      'EnvironmentNotRunningError',
      'PodNotFoundError',
      'LogStreamFailedError',
      'AbortError',
    ])('exports %s', (name) => {
      const exported = (lib as any)[name];
      expect(exported).toBeDefined();
      expect(typeof exported).toBe('function'); // classes are functions
    });

    it('error classes extend GroveError', () => {
      const err = new lib.RepoNotFoundError('test' as any);
      expect(err).toBeInstanceOf(lib.GroveError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('identity exports', () => {
    it('exports isRepoId', () => {
      expect(typeof lib.isRepoId).toBe('function');
    });

    it('exports asRepoId', () => {
      expect(typeof lib.asRepoId).toBe('function');
    });

    it('exports asWorkspaceId', () => {
      expect(typeof lib.asWorkspaceId).toBe('function');
    });
  });

  describe('namespace API functions', () => {
    it('repo has expected functions', () => {
      expect(typeof lib.repo.add).toBe('function');
      expect(typeof lib.repo.remove).toBe('function');
      expect(typeof lib.repo.list).toBe('function');
    });

    it('environment has expected functions', () => {
      expect(typeof lib.environment.up).toBe('function');
      expect(typeof lib.environment.down).toBe('function');
      expect(typeof lib.environment.destroy).toBe('function');
    });

    it('config has expected functions', () => {
      expect(typeof lib.config.load).toBe('function');
    });
  });
});
