import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

// Bootstrap check schemas
const BootstrapCheckSchema = z.discriminatedUnion('type', [
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

const BootstrapFixSchema = z.discriminatedUnion('type', [
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

const BootstrapStepSchema = z.object({
  name: z.string(),
  check: BootstrapCheckSchema,
  fix: BootstrapFixSchema,
});

// Service schemas
const ServiceBuildSchema = z.object({
  image: z.string(),
  dockerfile: z.string(),
  watchPaths: z.array(z.string()).optional(),
});

const PortForwardSchema = z.object({
  remotePort: z.number(),
  hostIp: z.string().optional().default('127.0.0.1'),
});

const HealthCheckSchema = z.object({
  path: z.string().optional(),
  protocol: z.enum(['http', 'tcp']).default('http'),
});

const ServiceSchema = z.object({
  name: z.string(),
  build: ServiceBuildSchema.optional(),
  portForward: PortForwardSchema.optional(),
  health: HealthCheckSchema.optional(),
});

// Frontend schema
const FrontendSchema = z.object({
  name: z.string(),
  command: z.string(),
  cwd: z.string(),
  env: z.record(z.string()).optional(),
  health: HealthCheckSchema.optional(),
});

// Main config schema
const GroveConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    cluster: z.string().default('twiglylabs-local'),
  }),
  helm: z.object({
    chart: z.string(),
    release: z.string(),
    valuesFiles: z.array(z.string()),
    secretsTemplate: z.string().optional(),
  }),
  services: z.array(ServiceSchema),
  frontends: z.array(FrontendSchema).optional(),
  bootstrap: z.array(BootstrapStepSchema).optional(),
});

export type BootstrapCheck = z.infer<typeof BootstrapCheckSchema>;
export type BootstrapFix = z.infer<typeof BootstrapFixSchema>;
export type BootstrapStep = z.infer<typeof BootstrapStepSchema>;
export type ServiceBuild = z.infer<typeof ServiceBuildSchema>;
export type PortForward = z.infer<typeof PortForwardSchema>;
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Frontend = z.infer<typeof FrontendSchema>;
export type GroveConfig = z.infer<typeof GroveConfigSchema> & {
  portBlockSize: number;
  repoRoot: string;
};

function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch (error) {
    throw new Error('Not in a git repository');
  }
}

export function loadConfig(rootDir?: string): GroveConfig {
  const repoRoot = rootDir || getRepoRoot();
  const configPath = join(repoRoot, '.grove.yaml');

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const configContent = readFileSync(configPath, 'utf-8');
  const rawConfig = parse(configContent);

  // Validate with zod
  const validatedConfig = GroveConfigSchema.parse(rawConfig);

  // Compute port block size (only services with portForward need ports)
  const portForwardedServiceCount = validatedConfig.services.filter(s => s.portForward).length;
  const frontendCount = validatedConfig.frontends?.length ?? 0;
  const portBlockSize = portForwardedServiceCount + frontendCount + 1; // +1 for buffer/future use

  return {
    ...validatedConfig,
    portBlockSize,
    repoRoot,
  };
}
