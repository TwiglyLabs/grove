/**
 * Grove API: Logs module
 *
 * File-based log reading and kubectl pod log streaming.
 * Resolves namespace from repo's environment state internally.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { load as loadConfig } from '../shared/config.js';
import { readState } from '../environment/state.js';
import type { RepoId } from '../shared/identity.js';
import {
  EnvironmentNotRunningError,
  PodNotFoundError,
  LogStreamFailedError,
} from '../shared/errors.js';
import type { LogEntry } from './types.js';

/**
 * Read file-based logs for a service (port-forward or frontend logs).
 * Returns null if no log file exists.
 */
export async function readLogs(repo: RepoId, service: string): Promise<LogEntry | null> {
  const config = await loadConfig(repo);
  const logsDir = join(config.repoRoot, '.grove', 'logs');

  const portForwardLog = join(logsDir, `port-forward-${service}.log`);
  const frontendLog = join(logsDir, `${service}.log`);

  if (existsSync(portForwardLog)) {
    return {
      service,
      type: 'port-forward',
      content: readFileSync(portForwardLog, 'utf-8'),
    };
  }

  if (existsSync(frontendLog)) {
    return {
      service,
      type: 'frontend',
      content: readFileSync(frontendLog, 'utf-8'),
    };
  }

  return null;
}

/**
 * Stream pod logs via kubectl. Returns an async iterable of log lines.
 *
 * Error contract:
 * - EnvironmentNotRunningError: no state file
 * - PodNotFoundError: no pod found for service
 * - LogStreamFailedError: kubectl connection drops mid-stream
 */
export async function* streamPodLogs(
  repo: RepoId,
  service: string,
  options?: { tail?: number },
): AsyncIterable<string> {
  const config = await loadConfig(repo);
  const state = readState(config);

  if (!state) {
    throw new EnvironmentNotRunningError();
  }

  const tail = options?.tail ?? 100;

  const proc = spawn(
    'kubectl',
    ['logs', '-n', state.namespace, '-l', `app=${service}`, '-f', `--tail=${tail}`],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  // Check for immediate failure (pod not found)
  let started = false;
  let stderrBuffer = '';

  proc.stderr?.on('data', (data: Buffer) => {
    stderrBuffer += data.toString();
  });

  // Create a line-based async iterable from stdout
  const lines = createLineIterator(proc.stdout!);

  try {
    for await (const line of lines) {
      started = true;
      yield line;
    }
  } catch (error) {
    if (!started && stderrBuffer.includes('not found')) {
      throw new PodNotFoundError(service);
    }
    throw new LogStreamFailedError(
      error instanceof Error ? error.message : 'kubectl log stream failed',
    );
  } finally {
    // Ensure the kubectl process is cleaned up
    if (proc.exitCode === null) {
      proc.kill('SIGTERM');
    }
  }

  // Check if kubectl exited with error before producing output
  if (!started && stderrBuffer.includes('not found')) {
    throw new PodNotFoundError(service);
  }
}

/**
 * Create an async line iterator from a readable stream.
 */
async function* createLineIterator(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<string> {
  let buffer = '';

  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      yield line;
    }
  }

  // Yield any remaining content
  if (buffer.length > 0) {
    yield buffer;
  }
}
