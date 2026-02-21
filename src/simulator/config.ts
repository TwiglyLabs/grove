/**
 * Simulator slice config schemas.
 *
 * Owns: simulator zod schema.
 * These are composed into the root GroveConfigSchema.
 */

import { z } from 'zod';

export const SimulatorSchema = z.object({
  platform: z.enum(['ios']).default('ios'),
  bundleId: z.string(),
  appName: z.string(),
  simulatorPrefix: z.string(),
  baseDevice: z.array(z.string()),
  deepLinkScheme: z.string(),
  metroFrontend: z.string(),
});

// --- Derived types ---

export type SimulatorConfig = z.infer<typeof SimulatorSchema>;
