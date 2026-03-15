/**
 * Tests for ServiceDeployer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceDeployer } from './ServiceDeployer.js';
import type { ServiceConfig } from '../vcluster-config.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
const mockExecSync = vi.mocked(execSync);

describe('ServiceDeployer', () => {
  let deployer: ServiceDeployer;

  beforeEach(() => {
    vi.clearAllMocks();
    deployer = new ServiceDeployer();
  });

  describe('deployRegistry()', () => {
    it('installs a registry service with helm', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployRegistry({ name: 'api', chart: 'oci://charts/api' });

      expect(mockExecSync).toHaveBeenCalledWith(
        'helm install api oci://charts/api   --wait --timeout 5m',
        { stdio: 'inherit' },
      );
    });

    it('includes version and values when provided', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployRegistry({
        name: 'api',
        chart: 'oci://charts/api',
        version: '2.0.0',
        values: 'api-values.yaml',
      });

      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain('--version 2.0.0');
      expect(call).toContain('-f api-values.yaml');
    });
  });

  describe('deployDev()', () => {
    it('builds docker image, pushes to local registry, and helm installs', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployDev({
        name: 'api',
        path: '../api',
        dev: true,
        dockerfile: 'Dockerfile',
        helmChart: 'deploy/helm',
      });

      // docker build
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker build -t api'),
        { stdio: 'inherit' },
      );

      // docker tag + push to local registry
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker tag api localhost:5001/api:latest'),
        { stdio: 'inherit' },
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('docker push localhost:5001/api:latest'),
        { stdio: 'inherit' },
      );

      // helm install
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('helm install api deploy/helm'),
        { stdio: 'inherit' },
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--set image.repository=localhost:5001/api'),
        { stdio: 'inherit' },
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('--set image.tag=latest'),
        { stdio: 'inherit' },
      );
    });

    it('uses specified dockerfile', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployDev({
        name: 'api',
        path: '../api',
        dev: true,
        dockerfile: 'Dockerfile.dev',
        helmChart: 'deploy/helm',
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-f Dockerfile.dev'),
        { stdio: 'inherit' },
      );
    });

    it('includes values file in helm install when specified', () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      deployer.deployDev({
        name: 'api',
        path: '../api',
        dev: true,
        dockerfile: 'Dockerfile',
        helmChart: 'deploy/helm',
        values: 'api-dev-values.yaml',
      });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('-f api-dev-values.yaml'),
        { stdio: 'inherit' },
      );
    });
  });

  describe('deployAll()', () => {
    it('deploys all services in parallel', async () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      const services: ServiceConfig[] = [
        { name: 'api', chart: 'oci://charts/api' },
        { name: 'worker', path: '../worker', dev: true, dockerfile: 'Dockerfile', helmChart: 'deploy/helm' },
      ];

      await deployer.deployAll(services);

      // Both should have been processed (multiple calls each)
      expect(mockExecSync).toHaveBeenCalled();
    });

    it('resolves immediately when no services provided', async () => {
      await expect(deployer.deployAll([])).resolves.toBeUndefined();
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it('filters services by only list when provided', async () => {
      mockExecSync.mockReturnValue(undefined as unknown as string);

      const services: ServiceConfig[] = [
        { name: 'api', chart: 'oci://charts/api' },
        { name: 'worker', chart: 'oci://charts/worker' },
      ];

      await deployer.deployAll(services, { only: ['api'] });

      // Only api should be deployed
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('helm install api'),
        { stdio: 'inherit' },
      );
      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining('helm install worker'),
        expect.anything(),
      );
    });

    it('rejects when any service deployment fails', async () => {
      mockExecSync
        .mockReturnValueOnce(undefined as unknown as string)
        .mockImplementationOnce(() => {
          throw new Error('worker deploy failed');
        });

      const services: ServiceConfig[] = [
        { name: 'api', chart: 'oci://charts/api' },
        { name: 'worker', chart: 'oci://charts/worker' },
      ];

      await expect(deployer.deployAll(services)).rejects.toThrow();
    });
  });
});
