/**
 * Callback-based event interfaces for the Grove library API.
 *
 * Consumers provide only the callbacks they care about. Callbacks are
 * fire-and-forget — the API does not await them.
 */

import type { GroveError } from '../shared/errors.js';

// --- Environment events (re-exported from environment slice) ---

export type { EnvironmentPhase, EnvironmentEvents } from '../environment/types.js';

// --- Workspace events (re-exported from workspace slice) ---

export type { WorkspaceEvents } from '../workspace/types.js';

// --- Non-environment events (remain here until satellite slices own them) ---

export interface TestEvents {
  onProgress?(phase: string, detail?: string): void;
  onTestComplete?(test: string, result: 'pass' | 'fail' | 'skip'): void;
  onError?(error: GroveError): void;
}
