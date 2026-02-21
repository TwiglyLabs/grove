import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

// --- Environment slice schemas (imported from owning slice) ---
import {
  BootstrapCheckSchema,
  BootstrapFixSchema,
  BootstrapStepSchema,
  ServiceBuildSchema,
  PortForwardSchema,
  HealthCheckSchema,
  ServiceSchema,
  FrontendSchema,
  ProjectSchema,
  HelmSchema,
  ReloadTargetsSchema,
} from './environment/config.js';

// Re-export environment schemas for consumers
export {
  BootstrapCheckSchema,
  BootstrapFixSchema,
  BootstrapStepSchema,
  ServiceBuildSchema,
  PortForwardSchema,
  HealthCheckSchema,
  ServiceSchema,
  FrontendSchema,
};

// Re-export environment types
export type {
  BootstrapCheck,
  BootstrapFix,
  BootstrapStep,
  ServiceBuild,
  PortForward,
  HealthCheck,
  Service,
  Frontend,
} from './environment/config.js';

// --- Testing slice schemas (imported from owning slice) ---
import {
  TestSuiteSchema,
  MobileTestingSchema,
  PlatformTestingSchema,
  ObservabilitySchema,
  TestingSchema,
} from './testing/config.js';

// Re-export testing schemas for consumers
export {
  TestSuiteSchema,
  MobileTestingSchema,
  PlatformTestingSchema,
  ObservabilitySchema,
  TestingSchema,
};

// Re-export testing types
export type {
  TestSuite,
  MobileTesting,
  PlatformTesting,
  Observability,
  Testing,
} from './testing/config.js';

// --- Simulator slice schemas (imported from owning slice) ---
import { SimulatorSchema } from './simulator/config.js';

// Re-export simulator schemas for consumers
export { SimulatorSchema };

// Re-export simulator types
export type { SimulatorConfig } from './simulator/config.js';

// --- Shell slice schemas (imported from owning slice) ---
import { ShellTargetSchema, ShellTargetsSchema } from './shell/config.js';

// Re-export shell schemas for consumers
export { ShellTargetSchema };

// Re-export shell types
export type { ShellTarget } from './shell/config.js';

// --- Workspace slice schemas (imported from owning slice) ---
import { WorkspaceRepoSchema, WorkspaceConfigSchema } from './workspace/config.js';
export { WorkspaceRepoSchema, WorkspaceConfigSchema };

// --- Composed root schema ---
// Assembles domain fragments into the full config shape.
// UtilitiesSchema is replaced: shellTargets comes from shell slice, reloadTargets from environment.
const UtilitiesSchema = z.object({
  shellTargets: ShellTargetsSchema,
  reloadTargets: ReloadTargetsSchema,
});

export const GroveConfigSchema = z.object({
  project: ProjectSchema,
  helm: HelmSchema,
  services: z.array(ServiceSchema),
  frontends: z.array(FrontendSchema).optional(),
  bootstrap: z.array(BootstrapStepSchema).optional(),
  testing: TestingSchema.optional(),
  simulator: SimulatorSchema.optional(),
  utilities: UtilitiesSchema.optional(),
  workspace: WorkspaceConfigSchema.optional(),
});

export type { WorkspaceRepo, WorkspaceConfig } from './workspace/config.js';
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

// Re-export workspace config loader from slice
export { loadWorkspaceConfig } from './workspace/config.js';
