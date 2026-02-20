/**
 * Environment slice types.
 *
 * Canonical type definitions for environment state, API results,
 * and event callbacks.
 */

import type { GroveError } from '../shared/errors.js';

// --- State types (from src/state.ts) ---

export interface ProcessInfo {
  pid: number;
  startedAt: string;
}

export interface SimulatorState {
  udid: string;
  name: string;
  basedOn: string;
  status: 'booted' | 'shutdown' | 'unknown';
}

export interface EnvironmentState {
  namespace: string;
  branch: string;
  worktreeId: string;
  ports: Record<string, number>;
  urls: Record<string, string>;
  processes: Record<string, ProcessInfo>;
  lastEnsure: string;
  simulator?: SimulatorState;
}

// --- API types (from src/api/types.ts) ---

export interface UpOptions {
  frontend?: string;
  all?: boolean;
  signal?: AbortSignal;
}

export interface UpResult {
  state: EnvironmentState;
  urls: Record<string, string>;
  ports: Record<string, number>;
  duration: number;
}

export interface DownResult {
  stopped: Array<{ name: string; pid: number; success: boolean }>;
  notRunning: string[];
}

export interface DestroyResult {
  stopped: DownResult;
  namespaceDeleted: boolean;
  stateRemoved: boolean;
}

export interface DashboardData {
  state: 'healthy' | 'degraded' | 'down' | 'unknown';
  namespace: string;
  services: Array<{
    name: string;
    status: 'running' | 'stopped' | 'error';
    port?: number;
    url?: string;
    pid?: number;
  }>;
  frontends: Array<{
    name: string;
    status: 'running' | 'stopped' | 'error';
    url?: string;
    pid?: number;
  }>;
  uptime?: number;
}

export interface WatchHandle {
  stop(): void;
  reload(service: string): void;
}

export interface PruneResult {
  deleted: string[];
  kept: string[];
}

// --- Event types (from src/api/events.ts) ---

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
