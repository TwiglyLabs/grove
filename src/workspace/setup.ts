import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import type { SetupResult } from './types.js';

/**
 * Run setup commands sequentially in the given working directory.
 * Fails fast on non-zero exit code — returns results up to and including the failure.
 */
export function runSetupCommands(commands: string[], cwd: string): SetupResult[] {
  const results: SetupResult[] = [];

  for (const command of commands) {
    const start = Date.now();
    const proc = spawnSync(command, {
      cwd,
      shell: true,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const result: SetupResult = {
      command,
      exitCode: proc.status ?? 1,
      stdout: proc.stdout ?? '',
      stderr: proc.stderr ?? '',
      durationMs: Date.now() - start,
    };

    results.push(result);

    if (result.exitCode !== 0) {
      break;
    }
  }

  return results;
}

/**
 * Run a lifecycle hook script at the given path.
 * Returns null if the hook path is not defined.
 * Throws if the hook script does not exist.
 */
export function runHook(hookPath: string, cwd: string): SetupResult {
  const resolved = resolve(cwd, hookPath);

  if (!existsSync(resolved)) {
    throw new Error(`Hook script not found: ${resolved}`);
  }

  const start = Date.now();
  const proc = spawnSync(resolved, {
    cwd,
    shell: true,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    command: hookPath,
    exitCode: proc.status ?? 1,
    stdout: proc.stdout ?? '',
    stderr: proc.stderr ?? '',
    durationMs: Date.now() - start,
  };
}
