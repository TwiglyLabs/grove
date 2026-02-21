/**
 * Unit tests for smoke test prerequisite helpers.
 *
 * These tests verify the pure logic in prerequisites.ts —
 * the formatting and gate functions — without actually
 * invoking system commands.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We import the module under test. To avoid real execSync calls,
// we mock the entire module's internal dependency via vi.mock.
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import {
  checkSmokePrerequisites,
  canRunSmokeTests,
  formatMissingSmokePrerequisites,
} from './prerequisites.js';

const mockExecSync = vi.mocked(execSync);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('checkSmokePrerequisites', () => {
  it('returns all true when all commands succeed', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));

    const result = checkSmokePrerequisites();

    expect(result.docker).toBe(true);
    expect(result.kubectl).toBe(true);
    expect(result.helm).toBe(true);
    expect(result.k3d).toBe(true);
    expect(result.colima).toBe(true);
    expect(result.clusterReachable).toBe(true);
  });

  it('returns false for commands that throw', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('docker')) throw new Error('not found');
      return Buffer.from('');
    });

    const result = checkSmokePrerequisites();

    expect(result.docker).toBe(false);
    expect(result.kubectl).toBe(true);
    expect(result.helm).toBe(true);
  });

  it('returns all false when all commands throw', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });

    const result = checkSmokePrerequisites();

    expect(result.docker).toBe(false);
    expect(result.kubectl).toBe(false);
    expect(result.helm).toBe(false);
    expect(result.k3d).toBe(false);
    expect(result.colima).toBe(false);
    expect(result.clusterReachable).toBe(false);
  });
});

describe('canRunSmokeTests', () => {
  it('returns true when docker, kubectl, helm, and k3d are present', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    expect(canRunSmokeTests()).toBe(true);
  });

  it('returns false when docker is missing', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('docker')) throw new Error('missing');
      return Buffer.from('');
    });
    expect(canRunSmokeTests()).toBe(false);
  });

  it('returns false when k3d is missing', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('k3d')) throw new Error('missing');
      return Buffer.from('');
    });
    expect(canRunSmokeTests()).toBe(false);
  });

  it('returns false when helm is missing', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('helm')) throw new Error('missing');
      return Buffer.from('');
    });
    expect(canRunSmokeTests()).toBe(false);
  });

  it('returns false when kubectl is missing', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('kubectl')) throw new Error('missing');
      return Buffer.from('');
    });
    expect(canRunSmokeTests()).toBe(false);
  });
});

describe('formatMissingSmokePrerequisites', () => {
  it('returns empty string when all prerequisites are met', () => {
    mockExecSync.mockReturnValue(Buffer.from(''));
    expect(formatMissingSmokePrerequisites()).toBe('');
  });

  it('returns message listing missing tools when some are absent', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('docker') || (cmd as string).includes('k3d')) {
        throw new Error('missing');
      }
      return Buffer.from('');
    });

    const msg = formatMissingSmokePrerequisites();

    expect(msg).toContain('Missing smoke test prerequisites:');
    expect(msg).toContain('docker');
    expect(msg).toContain('k3d');
    expect(msg).not.toContain('kubectl');
    expect(msg).not.toContain('helm');
  });

  it('includes colima as optional when missing', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('colima')) throw new Error('missing');
      return Buffer.from('');
    });

    const msg = formatMissingSmokePrerequisites();

    expect(msg).toContain('colima (optional');
  });

  it('includes cluster not reachable message when cluster check fails', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('cluster-info')) throw new Error('missing');
      return Buffer.from('');
    });

    const msg = formatMissingSmokePrerequisites();

    expect(msg).toContain('cluster not reachable');
  });
});
