import { execSync } from 'child_process';
import type { GroveConfig } from '../config.js';
import { HookFailedError } from '../shared/errors.js';
import { printInfo, printSuccess } from '../shared/output.js';

export function runPreDeployHooks(config: GroveConfig): void {
  const hooks = config.hooks?.['pre-deploy'];
  if (!hooks || hooks.length === 0) {
    return;
  }

  for (const hook of hooks) {
    printInfo(`Running hook: ${hook.name}`);
    try {
      execSync(hook.command, { stdio: 'inherit', cwd: config.repoRoot });
      printSuccess(`Hook completed: ${hook.name}`);
    } catch (error) {
      throw new HookFailedError(hook.name, error);
    }
  }
}
