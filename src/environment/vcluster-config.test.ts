/**
 * Tests for the new vCluster-based Grove environment config schema.
 */

import { describe, it, expect } from 'vitest';
import {
  groveEnvironmentConfigSchema,
  type GroveEnvironmentConfig,
  type ServiceConfig,
  type DevServiceConfig,
} from './vcluster-config.js';

describe('groveEnvironmentConfigSchema', () => {
  describe('platform', () => {
    it('requires a chart', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: {},
        databases: [],
        services: [],
      });
      expect(result.success).toBe(false);
    });

    it('accepts platform with chart only', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: { chart: 'oci://registry.example.com/platform' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.platform.chart).toBe('oci://registry.example.com/platform');
      }
    });

    it('accepts platform with version and values', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: {
          chart: 'oci://registry.example.com/platform',
          version: '1.2.3',
          values: 'platform-values.yaml',
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.platform.version).toBe('1.2.3');
        expect(result.data.platform.values).toBe('platform-values.yaml');
      }
    });
  });

  describe('databases', () => {
    it('defaults to empty array', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: { chart: 'some-chart' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.databases).toEqual([]);
      }
    });

    it('accepts database with name and chart', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: { chart: 'some-chart' },
        databases: [{ name: 'postgres', chart: 'oci://charts/postgres' }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.databases[0].name).toBe('postgres');
        expect(result.data.databases[0].chart).toBe('oci://charts/postgres');
      }
    });

    it('accepts database with version and values', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: { chart: 'some-chart' },
        databases: [
          {
            name: 'postgres',
            chart: 'oci://charts/postgres',
            version: '2.0.0',
            values: 'db-values.yaml',
          },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.databases[0].version).toBe('2.0.0');
        expect(result.data.databases[0].values).toBe('db-values.yaml');
      }
    });
  });

  describe('services', () => {
    it('defaults to empty array', () => {
      const result = groveEnvironmentConfigSchema.safeParse({
        platform: { chart: 'some-chart' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.services).toEqual([]);
      }
    });

    describe('registry service', () => {
      it('accepts a registry service with name and chart', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [{ name: 'api', chart: 'oci://charts/api' }],
        });
        expect(result.success).toBe(true);
      });

      it('accepts a registry service with version and values', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [
            {
              name: 'api',
              chart: 'oci://charts/api',
              version: '3.0.0',
              values: 'api-values.yaml',
            },
          ],
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const svc = result.data.services[0];
          expect(svc.name).toBe('api');
        }
      });
    });

    describe('dev service', () => {
      it('accepts a dev service with required fields', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [
            {
              name: 'api',
              path: '../api',
              dev: true,
            },
          ],
        });
        expect(result.success).toBe(true);
      });

      it('defaults dockerfile to Dockerfile', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [
            {
              name: 'api',
              path: '../api',
              dev: true,
            },
          ],
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const svc = result.data.services[0] as DevServiceConfig;
          expect(svc.dockerfile).toBe('Dockerfile');
        }
      });

      it('defaults helmChart to deploy/helm', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [
            {
              name: 'api',
              path: '../api',
              dev: true,
            },
          ],
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const svc = result.data.services[0] as DevServiceConfig;
          expect(svc.helmChart).toBe('deploy/helm');
        }
      });

      it('accepts custom dockerfile and helmChart', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [
            {
              name: 'api',
              path: '../api',
              dev: true,
              dockerfile: 'Dockerfile.dev',
              helmChart: 'deploy/helm/api',
            },
          ],
        });
        expect(result.success).toBe(true);
        if (result.success) {
          const svc = result.data.services[0] as DevServiceConfig;
          expect(svc.dockerfile).toBe('Dockerfile.dev');
          expect(svc.helmChart).toBe('deploy/helm/api');
        }
      });

      it('rejects dev: false — must be literal true', () => {
        const result = groveEnvironmentConfigSchema.safeParse({
          platform: { chart: 'some-chart' },
          services: [
            {
              name: 'api',
              path: '../api',
              dev: false,
            },
          ],
        });
        // dev: false should either fail or parse as registry service (no path field)
        // The discriminated union will attempt to parse as registry: name+chart required
        // Since chart is missing, it will fail
        expect(result.success).toBe(false);
      });
    });
  });

  describe('full valid config', () => {
    it('parses a complete config with all fields', () => {
      const raw = {
        platform: {
          chart: 'oci://registry.example.com/platform',
          version: '1.0.0',
          values: 'platform-values.yaml',
        },
        databases: [
          {
            name: 'postgres',
            chart: 'oci://charts/postgres',
            version: '15.0.0',
          },
        ],
        services: [
          {
            name: 'api',
            chart: 'oci://charts/api',
            version: '2.0.0',
          },
          {
            name: 'worker',
            path: '../worker',
            dev: true,
            dockerfile: 'Dockerfile.dev',
          },
        ],
      };

      const result = groveEnvironmentConfigSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.platform.chart).toBe('oci://registry.example.com/platform');
        expect(result.data.databases).toHaveLength(1);
        expect(result.data.services).toHaveLength(2);
      }
    });
  });
});

describe('type exports', () => {
  it('GroveEnvironmentConfig type is usable', () => {
    const config: GroveEnvironmentConfig = {
      platform: { chart: 'test' },
      databases: [],
      services: [],
    };
    expect(config.platform.chart).toBe('test');
  });
});
