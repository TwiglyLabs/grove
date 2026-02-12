import type { GroveConfig } from '../config.js';
import { pruneOrphanedResources } from '../prune.js';

export async function pruneCommand(config: GroveConfig): Promise<void> {
  pruneOrphanedResources(config);
}
