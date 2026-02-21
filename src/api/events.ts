/**
 * Callback-based event interfaces for the Grove library API.
 *
 * Consumers provide only the callbacks they care about. Callbacks are
 * fire-and-forget — the API does not await them.
 */

// --- Environment events (re-exported from environment slice) ---

export type { EnvironmentPhase, EnvironmentEvents } from '../environment/types.js';

// --- Workspace events (re-exported from workspace slice) ---

export type { WorkspaceEvents } from '../workspace/types.js';

// --- Testing events (re-exported from testing slice) ---

export type { TestEvents } from '../testing/types.js';
