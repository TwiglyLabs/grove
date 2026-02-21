import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { WorkspaceState } from './types.js';

const testDir = join(tmpdir(), `grove-ws-concurrency-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const {
  writeWorkspaceState,
  readWorkspaceState,
  listWorkspaceStates,
  deleteWorkspaceState,
} = await import('./state.js');

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    version: 1,
    id: 'test-workspace',
    status: 'active',
    branch: 'feature-x',
    createdAt: '2026-02-20T10:00:00Z',
    updatedAt: '2026-02-20T14:00:00Z',
    root: '/tmp/worktrees/test/feature-x',
    source: '/tmp/repos/test',
    repos: [
      {
        name: 'test',
        role: 'parent',
        source: '/tmp/repos/test',
        worktree: '/tmp/worktrees/test/feature-x',
        parentBranch: 'main',
      },
    ],
    sync: null,
    ...overrides,
  };
}

describe('workspace state concurrency', () => {
  beforeEach(() => {
    delete process.env.GROVE_STATE_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('concurrent writes for different IDs preserve all states', async () => {
    const count = 10;

    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        writeWorkspaceState(makeState({ id: `ws-${i}`, branch: `branch-${i}` })),
      ),
    );

    const states = listWorkspaceStates();
    expect(states).toHaveLength(count);

    for (let i = 0; i < count; i++) {
      const state = readWorkspaceState(`ws-${i}`);
      expect(state).not.toBeNull();
      expect(state!.branch).toBe(`branch-${i}`);
    }
  });

  it('concurrent writes for the same ID all succeed with retries', { timeout: 30_000 }, async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        writeWorkspaceState(
          makeState({
            id: 'contested',
            branch: `branch-${i}`,
            updatedAt: `2026-02-20T${String(i).padStart(2, '0')}:00:00Z`,
          }),
        ),
      ),
    );

    // The file on disk is valid (not corrupted)
    const state = readWorkspaceState('contested');
    expect(state).not.toBeNull();
    expect(state!.version).toBe(1);
    expect(state!.id).toBe('contested');
    expect(state!.branch).toMatch(/^branch-\d+$/);
  });

  it('high-volume concurrent writes to same file all succeed', { timeout: 30_000 }, async () => {
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        writeWorkspaceState(
          makeState({
            id: 'integrity',
            branch: `branch-${i}`,
            updatedAt: `2026-02-20T${String(i % 24).padStart(2, '0')}:00:00Z`,
          }),
        ),
      ),
    );

    // File is valid JSON
    const filePath = join(testDir, '.grove', 'workspaces', 'integrity.json');
    const content = readFileSync(filePath, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();

    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.id).toBe('integrity');
  });

  describe('mixed operations', () => {
    it('deleteWorkspaceState on one ID during concurrent writes to another', { timeout: 30_000 }, async () => {
      // Create two workspaces
      await writeWorkspaceState(makeState({ id: 'ws-delete', branch: 'delete-me' }));
      await writeWorkspaceState(makeState({ id: 'ws-keep', branch: 'keep-me' }));

      // Concurrently: delete ws-delete while writing to ws-keep
      await Promise.all([
        new Promise<void>(resolve => {
          deleteWorkspaceState('ws-delete');
          resolve();
        }),
        writeWorkspaceState(makeState({ id: 'ws-keep', branch: 'keep-me-updated' })),
      ]);

      // ws-delete should be gone
      expect(readWorkspaceState('ws-delete')).toBeNull();

      // ws-keep should be intact with updated data
      const kept = readWorkspaceState('ws-keep');
      expect(kept).not.toBeNull();
      expect(kept!.branch).toBe('keep-me-updated');
    });

    it('deleteWorkspaceState concurrent with writeWorkspaceState on same ID', { timeout: 30_000 }, async () => {
      await writeWorkspaceState(makeState({ id: 'contested', branch: 'original' }));

      // Race: delete and write compete on the same state file.
      // Either outcome is valid — file deleted or file updated.
      await Promise.all([
        new Promise<void>(resolve => {
          deleteWorkspaceState('contested');
          resolve();
        }),
        writeWorkspaceState(makeState({ id: 'contested', branch: 'updated' })),
      ]);

      const filePath = join(testDir, '.grove', 'workspaces', 'contested.json');
      if (existsSync(filePath)) {
        const state = readWorkspaceState('contested');
        expect(state).not.toBeNull();
        expect(state!.id).toBe('contested');
      }
      // If file is gone, delete won — also valid
    });

    it('setup failure in one workspace does not affect another', { timeout: 30_000 }, async () => {
      // Simulates the Canopy scenario: two workspaces being created in parallel,
      // one transitioning to 'failed' (setup error) while the other stays 'active'.
      await Promise.all([
        writeWorkspaceState(makeState({ id: 'ws-ok', status: 'active', branch: 'ok' })),
        writeWorkspaceState(makeState({ id: 'ws-fail', status: 'failed', branch: 'fail' })),
      ]);

      const ok = readWorkspaceState('ws-ok');
      const fail = readWorkspaceState('ws-fail');

      expect(ok).not.toBeNull();
      expect(ok!.status).toBe('active');

      expect(fail).not.toBeNull();
      expect(fail!.status).toBe('failed');

      // Both state files are independent — the failed workspace didn't corrupt the active one
      const states = listWorkspaceStates();
      expect(states).toHaveLength(2);
    });

    it('status transitions during concurrent writes are isolated', { timeout: 30_000 }, async () => {
      // Create 5 workspaces, then update them all concurrently with different statuses
      for (let i = 0; i < 5; i++) {
        await writeWorkspaceState(makeState({ id: `ws-${i}`, status: 'creating', branch: `b-${i}` }));
      }

      const statuses: Array<WorkspaceState['status']> = ['active', 'failed', 'active', 'closing', 'active'];

      await Promise.all(
        statuses.map((status, i) =>
          writeWorkspaceState(makeState({ id: `ws-${i}`, status, branch: `b-${i}` })),
        ),
      );

      for (let i = 0; i < 5; i++) {
        const state = readWorkspaceState(`ws-${i}`);
        expect(state).not.toBeNull();
        expect(state!.status).toBe(statuses[i]);
      }
    });
  });
});
