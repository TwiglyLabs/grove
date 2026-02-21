/**
 * Testing slice types.
 *
 * Owns all test-related types: platforms, options, results, events.
 */

import type { GroveError } from '../shared/errors.js';

/** Test platform */
export type TestPlatform = 'mobile' | 'webapp' | 'api';

/** Options for running tests (internal — used by the runner) */
export interface TestOptions {
  platform: TestPlatform;
  suite?: string;
  flow?: string[];
  file?: string;
  grep?: string;
  useDev?: boolean;
  excludeAi?: boolean;
  ai?: boolean;
  noEnsure?: boolean;
  timeout?: number;
  verbose?: boolean;
}

/** Detail about a single test failure */
export interface FailureDetail {
  test: string;
  message: string;
  file?: string;
  line?: number;
}

/** Paths to test artifacts */
export interface ArtifactPaths {
  screenshots?: string;
  videos?: string;
  reports?: string;
}

/** Paths to test log files */
export interface LogPaths {
  stdout: string;
  stderr: string;
  junit?: string;
  apiTraces?: string;
}

/** Full result of a test run */
export interface TestResult {
  run: {
    id: string;
    platform: string;
    suite: string;
    duration: string;
    result: 'pass' | 'fail' | 'error' | 'timeout';
  };
  environment: {
    worktree: string;
    namespace: string;
  };
  tests: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
  failures: FailureDetail[];
  artifacts: ArtifactPaths;
  logs: LogPaths;
}

/** Options for the public API run() function */
export interface TestRunOptions {
  platform: TestPlatform;
  suite?: string;
  flow?: string[];
  file?: string;
  grep?: string;
  useDev?: boolean;
  excludeAi?: boolean;
  ai?: boolean;
  noEnsure?: boolean;
  timeout?: number;
  verbose?: boolean;
  signal?: AbortSignal;
}

/** Callback-based event interface for test runs */
export interface TestEvents {
  onProgress?(phase: string, detail?: string): void;
  onTestComplete?(test: string, result: 'pass' | 'fail' | 'skip'): void;
  onError?(error: GroveError): void;
}
