/**
 * New vCluster-based Grove environment config schema.
 *
 * This schema is used when a .grove.yaml has a `platform` key,
 * indicating the new vCluster-based deployment model.
 *
 * It coexists with the existing GroveConfigSchema (detected by the presence
 * of the `project` key). Detection is done in the config loader.
 */

import { z } from 'zod';

// --- Registry service (deployed from a Helm chart in a registry) ---

const registryServiceSchema = z.object({
  name: z.string(),
  chart: z.string(),
  version: z.string().optional(),
  values: z.string().optional(),
});

// --- Dev service (built locally and deployed via local Helm chart) ---

const devServiceSchema = z.object({
  name: z.string(),
  path: z.string(),
  dev: z.literal(true),
  dockerfile: z.string().default('Dockerfile'),
  helmChart: z.string().default('deploy/helm'),
  values: z.string().optional(),
});

// --- Union: either registry or dev service ---

const serviceSchema = z.union([devServiceSchema, registryServiceSchema]);

// --- Platform chart (Kong, Dapr, infra) ---

const platformSchema = z.object({
  chart: z.string(),
  version: z.string().optional(),
  values: z.string().optional(),
});

// --- Database chart (Atlas migrations, etc.) ---

const databaseSchema = z.object({
  name: z.string(),
  chart: z.string(),
  version: z.string().optional(),
  values: z.string().optional(),
});

// --- Root schema ---

export const groveEnvironmentConfigSchema = z.object({
  platform: platformSchema,
  databases: z.array(databaseSchema).default([]),
  services: z.array(serviceSchema).default([]),
});

// --- Derived types ---

export type GroveEnvironmentConfig = z.infer<typeof groveEnvironmentConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceSchema>;
export type DevServiceConfig = z.infer<typeof devServiceSchema>;
export type RegistryServiceConfig = z.infer<typeof registryServiceSchema>;
export type PlatformConfig = z.infer<typeof platformSchema>;
export type DatabaseConfig = z.infer<typeof databaseSchema>;

/**
 * Detect whether a raw config object uses the new vCluster-based schema.
 * The new format is identified by the presence of the `platform` key.
 */
export function isVClusterConfig(raw: unknown): boolean {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    'platform' in raw
  );
}

/**
 * Type guard: check if a ServiceConfig is a DevServiceConfig.
 */
export function isDevService(service: ServiceConfig): service is DevServiceConfig {
  return 'dev' in service && service.dev === true;
}
