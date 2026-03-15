/**
 * Tests for DatabaseDeployer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseDeployer } from './DatabaseDeployer.js';
import type { DatabaseConfig } from '../vcluster-config.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('DatabaseDeployer', () => {
  let deployer: DatabaseDeployer;

  beforeEach(() => {
    vi.clearAllMocks();
    deployer = new DatabaseDeployer();
  });

  describe('deployOne()', () => {
    it('runs helm install for a database with name and chart', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployOne({ name: 'postgres', chart: 'oci://charts/postgres' });

      expect(mockExecSync).toHaveBeenCalledWith(
        'helm install postgres oci://charts/postgres   --wait --timeout 5m',
        { stdio: 'inherit' },
      );
    });

    it('includes version flag when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployOne({
        name: 'postgres',
        chart: 'oci://charts/postgres',
        version: '15.0.0',
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--version 15.0.0'),
        { stdio: 'inherit' },
      );
    });

    it('includes values flag when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployOne({
        name: 'postgres',
        chart: 'oci://charts/postgres',
        values: 'db-values.yaml',
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-f db-values.yaml'),
        { stdio: 'inherit' },
      );
    });

    it('throws when helm install fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('helm install failed');
      });

      expect(() =>
        deployer.deployOne({ name: 'postgres', chart: 'oci://charts/postgres' }),
      ).toThrow('helm install failed');
    });
  });

  describe('deployAll()', () => {
    it('deploys all databases', async () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      const databases: DatabaseConfig[] = [
        { name: 'postgres', chart: 'oci://charts/postgres' },
        { name: 'redis', chart: 'oci://charts/redis' },
      ];

      await deployer.deployAll(databases);

      expect(mockExecSync).toHaveBeenCalledTimes(2);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('helm install postgres'),
        { stdio: 'inherit' },
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('helm install redis'),
        { stdio: 'inherit' },
      );
    });

    it('resolves immediately when no databases are provided', async () => {
      await expect(deployer.deployAll([])).resolves.toBeUndefined();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('rejects when any database deployment fails', async () => {
      mockExecSync
        .mockReturnValueOnce(undefined as unknown as string)
        .mockImplementationOnce(() => {
          throw new Error('redis install failed');
        });

      const databases: DatabaseConfig[] = [
        { name: 'postgres', chart: 'oci://charts/postgres' },
        { name: 'redis', chart: 'oci://charts/redis' },
      ];

      await expect(deployer.deployAll(databases)).rejects.toThrow();
    });
  });
});
