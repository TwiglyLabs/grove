/**
 * Testing slice config schemas.
 *
 * Owns: testing and observability zod schemas.
 * These are composed into the root GroveConfigSchema.
 */

import { z } from 'zod';

export const TestSuiteSchema = z.object({
  name: z.string(),
  paths: z.array(z.string()),
});

export const MobileTestingSchema = z.object({
  runner: z.string().default('maestro'),
  basePath: z.string(),
  suites: z.array(TestSuiteSchema).optional(),
  envVars: z.record(z.string()).optional(),
});

export const PlatformTestingSchema = z.object({
  runner: z.string(),
  cwd: z.string(),
  envVars: z.record(z.string()).optional(),
});

export const ObservabilitySchema = z.object({
  serviceName: z.string(),
  traceEndpoint: z.string().optional(),
});

export const TestingSchema = z.object({
  mobile: MobileTestingSchema.optional(),
  webapp: PlatformTestingSchema.optional(),
  api: PlatformTestingSchema.optional(),
  observability: ObservabilitySchema.optional(),
  historyDir: z.string().default('.grove/test-history'),
  historyLimit: z.number().default(10),
  defaultTimeout: z.number().default(300000),
});

// --- Derived types ---

export type TestSuite = z.infer<typeof TestSuiteSchema>;
export type MobileTesting = z.infer<typeof MobileTestingSchema>;
export type PlatformTesting = z.infer<typeof PlatformTestingSchema>;
export type Observability = z.infer<typeof ObservabilitySchema>;
export type Testing = z.infer<typeof TestingSchema>;
