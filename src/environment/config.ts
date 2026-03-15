/**
 * Environment slice config schemas.
 *
 * Owns: project, helm, services, frontends, bootstrap, reloadTargets.
 * These are composed into the root GroveConfigSchema.
 */

import { z } from 'zod';

// --- Bootstrap schemas ---

export const BootstrapCheckSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('fileExists'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('dirExists'),
    path: z.string(),
  }),
  z.object({
    type: z.literal('commandSucceeds'),
    command: z.string(),
  }),
]);

export const BootstrapFixSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('copyFrom'),
    source: z.string(),
    dest: z.string(),
  }),
  z.object({
    type: z.literal('run'),
    command: z.string(),
  }),
]);

export const BootstrapStepSchema = z.object({
  name: z.string(),
  check: BootstrapCheckSchema,
  fix: BootstrapFixSchema,
});

// --- Service schemas ---

export const ServiceBuildSchema = z.object({
  image: z.string(),
  dockerfile: z.string(),
  args: z.record(z.string()).optional(),
  watchPaths: z.array(z.string()).optional(),
});

export const PortForwardSchema = z.object({
  remotePort: z.number().int().min(1).max(65535),
  hostIp: z.string().ip({ version: 'v4' }).optional().default('127.0.0.1'),
  serviceName: z.string().optional(),
});

export const HealthCheckSchema = z.object({
  path: z.string().optional(),
  protocol: z.enum(['http', 'tcp']).default('http'),
});

export const ServiceSchema = z.object({
  name: z.string(),
  build: ServiceBuildSchema.optional(),
  portForward: PortForwardSchema.optional(),
  health: HealthCheckSchema.optional(),
});

// --- Frontend schemas ---

export const FrontendSchema = z.object({
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  env: z.record(z.string()).optional(),
  health: HealthCheckSchema.optional(),
});

// --- Project and Helm schemas ---

export const ClusterTypeSchema = z.enum(['kind', 'k3s']).default('kind');

export const ProjectSchema = z.object({
  name: z.string(),
  cluster: z.string().default('twiglylabs-local'),
  clusterType: ClusterTypeSchema,
  registry: z.string().optional(),
});

export const HelmSchema = z.object({
  chart: z.string(),
  release: z.string(),
  valuesFiles: z.array(z.string()),
  secretsTemplate: z.string().optional(),
  wait: z.boolean().optional(),
});

// --- Reload targets (owned by environment slice) ---

export const ReloadTargetsSchema = z.array(z.string()).optional();

// --- Hook schemas ---

export const HookStepSchema = z.object({
  name: z.string(),
  command: z.string(),
});

export const EnvironmentHooksSchema = z.object({
  'pre-deploy': z.array(HookStepSchema).optional(),
});

// --- Derived types ---

export type BootstrapCheck = z.infer<typeof BootstrapCheckSchema>;
export type BootstrapFix = z.infer<typeof BootstrapFixSchema>;
export type BootstrapStep = z.infer<typeof BootstrapStepSchema>;
export type ServiceBuild = z.infer<typeof ServiceBuildSchema>;
export type PortForward = z.infer<typeof PortForwardSchema>;
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Frontend = z.infer<typeof FrontendSchema>;
export type HookStep = z.infer<typeof HookStepSchema>;
export type EnvironmentHooks = z.infer<typeof EnvironmentHooksSchema>;
