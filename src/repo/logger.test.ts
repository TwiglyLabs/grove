/**
 * Tests verifying Logger injection into repo API operations.
 *
 * These tests verify that when a Logger is passed to repo.add() and repo.remove(),
 * the logger is called with appropriate messages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Logger } from '@twiglylabs/log';

const testDir = join(tmpdir(), `grove-repo-logger-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { add, remove } = await import('./api.js');

function makeMockLogger(): Logger {
  const child: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => child),
  };
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => child),
  };
}

describe('repo API logger injection', () => {
  beforeEach(() => {
    delete process.env.GROVE_REGISTRY_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('add with logger', () => {
    it('calls logger.info when a new repo is registered', async () => {
      const logger = makeMockLogger();
      const childLogger = logger.child('grove:repo');

      await add('/tmp/logger-test-repo', { logger });

      expect(childLogger.info).toHaveBeenCalled();
    });

    it('works without logger (backward compatible)', async () => {
      // Must not throw when no logger provided
      await expect(add('/tmp/no-logger-repo')).resolves.toBeDefined();
    });
  });

  describe('remove with logger', () => {
    it('calls logger.info when a repo is removed', async () => {
      const logger = makeMockLogger();
      const childLogger = logger.child('grove:repo');

      // First add without logger, then remove with logger
      const entry = await add('/tmp/remove-logger-repo');
      await remove(entry.id, { logger });

      expect(childLogger.info).toHaveBeenCalled();
    });

    it('works without logger (backward compatible)', async () => {
      const entry = await add('/tmp/remove-no-logger-repo');
      await expect(remove(entry.id)).resolves.toBeUndefined();
    });
  });
});
