import type { GroveConfig } from '../config.js';
import { ensureEnvironment } from '../controller.js';
import type { UpOptions } from '../controller.js';
import { printBanner, printUrlTable } from '../output.js';

export async function upCommand(config: GroveConfig, options: UpOptions): Promise<void> {
  printBanner(config.project.name);

  const state = await ensureEnvironment(config, options);

  printUrlTable(state.urls);
}
