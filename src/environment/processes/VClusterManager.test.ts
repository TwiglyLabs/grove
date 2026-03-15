/**
 * Tests for VClusterManager.
 *
 * All execSync calls are mocked so no real vcluster binary is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VClusterManager } from './VClusterManager.js';

// Mock child_process at module level
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('VClusterManager', () => {
  let manager: VClusterManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new VClusterManager();
  });

  describe('exists()', () => {
    it('returns true when cluster name is found in list output', () => {
      mockExecSync.mockReturnValue(
        JSON.stringify([{ Name: 'my-cluster' }, { Name: 'other-cluster' }]),
      );
      expect(manager.exists('my-cluster')).toBe(true);
    });

    it('returns false when cluster name is not in list output', () => {
      mockExecSync.mockReturnValue(JSON.stringify([{ Name: 'other-cluster' }]));
      expect(manager.exists('my-cluster')).toBe(false);
    });

    it('returns false when vcluster list fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('vcluster not found');
      });
      expect(manager.exists('my-cluster')).toBe(false);
    });

    it('returns false for empty cluster list', () => {
      mockExecSync.mockReturnValue(JSON.stringify([]));
      expect(manager.exists('my-cluster')).toBe(false);
    });
  });

  describe('create()', () => {
    it('creates a cluster when it does not exist', () => {
      // First call is for exists() check (vcluster list)
      mockExecSync
        .mockReturnValueOnce(JSON.stringify([]))
        .mockReturnValueOnce(undefined as unknown as string);

      manager.create('my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'vcluster create my-cluster --namespace vcluster-system',
        { stdio: 'inherit' },
      );
    });

    it('skips creation when cluster already exists', () => {
      mockExecSync.mockReturnValue(JSON.stringify([{ Name: 'my-cluster' }]));

      manager.create('my-cluster');

      // Only the list call is made, not the create call
      expect(mockExecSync).toHaveBeenCalledTimes(1);
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining('vcluster create'),
        expect.anything(),
      );
    });

    it('uses a custom namespace when specified', () => {
      mockExecSync
        .mockReturnValueOnce(JSON.stringify([]))
        .mockReturnValueOnce(undefined as unknown as string);

      manager.create('my-cluster', 'custom-ns');

      expect(mockExecSync).toHaveBeenCalledWith(
        'vcluster create my-cluster --namespace custom-ns',
        { stdio: 'inherit' },
      );
    });
  });

  describe('connect()', () => {
    it('calls vcluster connect with the cluster name', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      manager.connect('my-cluster');
      expect(mockExecSync).toHaveBeenCalledWith('vcluster connect my-cluster', {
        stdio: 'inherit',
      });
    });
  });

  describe('disconnect()', () => {
    it('calls vcluster disconnect', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      manager.disconnect();
      expect(mockExecSync).toHaveBeenCalledWith('vcluster disconnect', {
        stdio: 'inherit',
      });
    });
  });

  describe('delete()', () => {
    it('calls vcluster delete with the cluster name', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      manager.delete('my-cluster');
      expect(mockExecSync).toHaveBeenCalledWith('vcluster delete my-cluster', {
        stdio: 'inherit',
      });
    });
  });

  describe('VClusterManager.nameFromContext()', () => {
    it('combines project and branch with a hyphen', () => {
      expect(VClusterManager.nameFromContext('myapp', 'main')).toBe('myapp-main');
    });

    it('lowercases the result', () => {
      expect(VClusterManager.nameFromContext('MyApp', 'Main')).toBe('myapp-main');
    });

    it('replaces non-alphanumeric characters with hyphens', () => {
      expect(VClusterManager.nameFromContext('my_app', 'feat/my-feature')).toBe(
        'my-app-feat-my-feature',
      );
    });

    it('collapses consecutive hyphens', () => {
      expect(VClusterManager.nameFromContext('my--app', 'feat//branch')).toBe(
        'my-app-feat-branch',
      );
    });

    it('truncates to 63 characters', () => {
      const longProject = 'a'.repeat(40);
      const longBranch = 'b'.repeat(40);
      const result = VClusterManager.nameFromContext(longProject, longBranch);
      expect(result.length).toBeLessThanOrEqual(63);
    });
  });
});
