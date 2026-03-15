/**
 * Tests for PlatformDeployer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlatformDeployer } from './PlatformDeployer.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('PlatformDeployer', () => {
  let deployer: PlatformDeployer;

  beforeEach(() => {
    vi.clearAllMocks();
    deployer = new PlatformDeployer();
  });

  describe('isInstalled()', () => {
    it('returns true when helm status platform succeeds', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      expect(deployer.isInstalled()).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith('helm status platform', { stdio: 'ignore' });
    });

    it('returns false when helm status throws', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('release not found');
      });
      expect(deployer.isInstalled()).toBe(false);
    });
  });

  describe('install()', () => {
    it('runs helm install with chart only', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.install({ chart: 'oci://charts/platform' });
      expect(mockExecSync).toHaveBeenCalledWith(
        'helm install platform oci://charts/platform   --wait --timeout 5m',
        { stdio: 'inherit' },
      );
    });

    it('includes version flag when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.install({ chart: 'oci://charts/platform', version: '1.0.0' });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--version 1.0.0'),
        { stdio: 'inherit' },
      );
    });

    it('includes values flag when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.install({ chart: 'oci://charts/platform', values: 'platform.yaml' });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-f platform.yaml'),
        { stdio: 'inherit' },
      );
    });

    it('includes both version and values when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.install({
        chart: 'oci://charts/platform',
        version: '2.0.0',
        values: 'platform.yaml',
      });
      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain('--version 2.0.0');
      expect(call).toContain('-f platform.yaml');
    });
  });

  describe('upgrade()', () => {
    it('runs helm upgrade with chart only', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.upgrade({ chart: 'oci://charts/platform' });
      expect(mockExecSync).toHaveBeenCalledWith(
        'helm upgrade platform oci://charts/platform   --wait --timeout 5m',
        { stdio: 'inherit' },
      );
    });

    it('includes version flag when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.upgrade({ chart: 'oci://charts/platform', version: '3.0.0' });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--version 3.0.0'),
        { stdio: 'inherit' },
      );
    });

    it('includes values flag when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);
      deployer.upgrade({ chart: 'oci://charts/platform', values: 'plat.yaml' });
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-f plat.yaml'),
        { stdio: 'inherit' },
      );
    });
  });
});
