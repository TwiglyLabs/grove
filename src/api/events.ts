/**
 * Callback-based event interfaces for the Grove library API.
 *
 * Consumers provide only the callbacks they care about. Callbacks are
 * fire-and-forget — the API does not await them.
 */

import type { GroveError } from '../shared/errors.js';

export type EnvironmentPhase =
  | 'cluster'
  | 'bootstrap'
  | 'state'
  | 'namespace'
  | 'build'
  | 'deploy'
  | 'port-forward'
  | 'frontend'
  | 'health-check'
  | 'stopping'
  | 'destroying';

export interface EnvironmentEvents {
  onPhase?(phase: EnvironmentPhase, message: string): void;
  onProgress?(step: string, detail?: string): void;
  onServiceStatus?(
    service: string,
    status: 'building' | 'deploying' | 'ready' | 'failed' | 'stopping' | 'stopped',
  ): void;
  onHealthCheck?(target: string, healthy: boolean): void;
  onFileChange?(service: string, files: string[]): void;
  onRebuild?(service: string, phase: 'start' | 'complete' | 'error', error?: string): void;
  onError?(error: GroveError): void;
}

export interface WorkspaceEvents {
  onProgress?(step: string, repo?: string, detail?: string): void;
  onConflict?(repo: string, files: string[]): void;
  onError?(error: GroveError): void;
}

export interface TestEvents {
  onProgress?(phase: string, detail?: string): void;
  onTestComplete?(test: string, result: 'pass' | 'fail' | 'skip'): void;
  onError?(error: GroveError): void;
}
