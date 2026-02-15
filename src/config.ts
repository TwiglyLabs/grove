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

// Testing schemas
const TestSuiteSchema = z.object({
  name: z.string(),
  paths: z.array(z.string()),
});

const MobileTestingSchema = z.object({
  runner: z.string().default('maestro'),
  basePath: z.string(),
  suites: z.array(TestSuiteSchema).optional(),
  envVars: z.record(z.string()).optional(),
});

const PlatformTestingSchema = z.object({
  runner: z.string(),
  cwd: z.string(),
  envVars: z.record(z.string()).optional(),
});

const ObservabilitySchema = z.object({
  serviceName: z.string(),
  traceEndpoint: z.string().optional(),
});

const TestingSchema = z.object({
  mobile: MobileTestingSchema.optional(),
  webapp: PlatformTestingSchema.optional(),
  api: PlatformTestingSchema.optional(),
  observability: ObservabilitySchema.optional(),
  historyDir: z.string().default('.grove/test-history'),
  historyLimit: z.number().default(10),
  defaultTimeout: z.number().default(300000),
});

// Simulator schema
const SimulatorSchema = z.object({
  platform: z.enum(['ios']).default('ios'),
  bundleId: z.string(),
  appName: z.string(),
  simulatorPrefix: z.string(),
  baseDevice: z.array(z.string()),
  deepLinkScheme: z.string(),
  metroFrontend: z.string(),
});

// Utilities schemas
const ShellTargetSchema = z.object({
  name: z.string(),
  podSelector: z.string().optional(),
  shell: z.string().optional(),
});

const UtilitiesSchema = z.object({
  shellTargets: z.array(ShellTargetSchema).optional(),
  reloadTargets: z.array(z.string()).optional(),
});

// Workspace schemas
const WorkspaceRepoSchema = z.object({
  path: z.string().min(1),
  remote: z.string().optional(),
});

const WorkspaceConfigSchema = z.object({
  repos: z.array(WorkspaceRepoSchema).min(1),
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
  testing: TestingSchema.optional(),
  simulator: SimulatorSchema.optional(),
  utilities: UtilitiesSchema.optional(),
  workspace: WorkspaceConfigSchema.optional(),
});

export type BootstrapCheck = z.infer<typeof BootstrapCheckSchema>;
export type BootstrapFix = z.infer<typeof BootstrapFixSchema>;
export type BootstrapStep = z.infer<typeof BootstrapStepSchema>;
export type ServiceBuild = z.infer<typeof ServiceBuildSchema>;
export type PortForward = z.infer<typeof PortForwardSchema>;
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type Frontend = z.infer<typeof FrontendSchema>;
export type TestSuite = z.infer<typeof TestSuiteSchema>;
export type MobileTesting = z.infer<typeof MobileTestingSchema>;
export type PlatformTesting = z.infer<typeof PlatformTestingSchema>;
export type Observability = z.infer<typeof ObservabilitySchema>;
export type Testing = z.infer<typeof TestingSchema>;
export type SimulatorConfig = z.infer<typeof SimulatorSchema>;
export type ShellTarget = z.infer<typeof ShellTargetSchema>;
export type WorkspaceRepo = z.infer<typeof WorkspaceRepoSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;
export type Utilities = z.infer<typeof UtilitiesSchema>;
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

// Partial schema for workspace-only parsing (doesn't require project/helm/services)
const PartialGroveConfigSchema = z.object({
  workspace: WorkspaceConfigSchema.optional(),
}).passthrough();

/**
 * Load workspace config from .grove.yaml. Returns null if file is missing
 * or has no workspace section. Does NOT throw for missing config.
 */
export function loadWorkspaceConfig(repoRoot: string): WorkspaceConfig | null {
  const configPath = join(repoRoot, '.grove.yaml');
  if (!existsSync(configPath)) return null;

  try {
    const raw = parse(readFileSync(configPath, 'utf-8'));
    const parsed = PartialGroveConfigSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data.workspace ?? null;
  } catch {
    return null;
  }
}
