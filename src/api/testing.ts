/**
 * Grove API: Testing module
 *
 * Test execution and result management.
 * Accepts RepoId, resolves config internally.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { load as loadConfig } from '../shared/config.js';
import type { RepoId } from '../shared/identity.js';
import type { TestEvents } from './events.js';
import type { TestRunOptions } from './types.js';
import type { TestResult, TestPlatform } from '../types.js';
import { runTests as internalRunTests } from '../testing/test-runner.js';

/**
 * Run tests for a repo. Resolves config from RepoId.
 */
export async function runTests(
  repo: RepoId,
  options: TestRunOptions,
  _events?: TestEvents,
): Promise<TestResult> {
  const config = await loadConfig(repo);

  return internalRunTests(config, {
    platform: options.platform,
    suite: options.suite,
    flow: options.flow,
    file: options.file,
    grep: options.grep,
    useDev: options.useDev,
    excludeAi: options.excludeAi,
    ai: options.ai,
    noEnsure: options.noEnsure,
    timeout: options.timeout,
    verbose: options.verbose,
  });
}

/**
 * Read test history from the archive directory.
 * Returns past test results, optionally filtered by platform.
 */
export async function getTestHistory(
  repo: RepoId,
  platform?: TestPlatform,
): Promise<TestResult[]> {
  const config = await loadConfig(repo);
  const historyDir = join(config.repoRoot, config.testing?.historyDir ?? '.grove/test-history');

  let entries: string[];
  try {
    entries = readdirSync(historyDir)
      .filter(e => e.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/))
      .sort()
      .reverse();
  } catch {
    return [];
  }

  // Filter by platform if specified
  if (platform) {
    entries = entries.filter(e => e.includes(`-${platform}`));
  }

  const results: TestResult[] = [];

  for (const entry of entries) {
    // Try to read a results.json or reconstruct from available data
    const resultFile = join(historyDir, entry, 'results.json');
    try {
      const content = readFileSync(resultFile, 'utf-8');
      results.push(JSON.parse(content) as TestResult);
    } catch {
      // No parseable result file in this archive entry
    }
  }

  return results;
}
