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

    const states = await listWorkspaceStates();
    expect(states).toHaveLength(count);

    for (let i = 0; i < count; i++) {
      const state = await readWorkspaceState(`ws-${i}`);
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
    const state = await readWorkspaceState('contested');
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
        deleteWorkspaceState('ws-delete'),
        writeWorkspaceState(makeState({ id: 'ws-keep', branch: 'keep-me-updated' })),
      ]);

      // ws-delete should be gone
      expect(await readWorkspaceState('ws-delete')).toBeNull();

      // ws-keep should be intact with updated data
      const kept = await readWorkspaceState('ws-keep');
      expect(kept).not.toBeNull();
      expect(kept!.branch).toBe('keep-me-updated');
    });

    it('deleteWorkspaceState concurrent with writeWorkspaceState on same ID', { timeout: 30_000 }, async () => {
      await writeWorkspaceState(makeState({ id: 'contested', branch: 'original' }));

      // Race: delete and write compete on the same state file.
      // Either outcome is valid — file deleted or file updated.
      await Promise.all([
        deleteWorkspaceState('contested'),
        writeWorkspaceState(makeState({ id: 'contested', branch: 'updated' })),
      ]);

      const filePath = join(testDir, '.grove', 'workspaces', 'contested.json');
      if (existsSync(filePath)) {
        const state = await readWorkspaceState('contested');
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

      const ok = await readWorkspaceState('ws-ok');
      const fail = await readWorkspaceState('ws-fail');

      expect(ok).not.toBeNull();
      expect(ok!.status).toBe('active');

      expect(fail).not.toBeNull();
      expect(fail!.status).toBe('failed');

      // Both state files are independent — the failed workspace didn't corrupt the active one
      const states = await listWorkspaceStates();
      expect(states).toHaveLength(2);
    });

    it('concurrent reads during delete return valid state or null, never throw', { timeout: 30_000 }, async () => {
      await writeWorkspaceState(makeState({ id: 'read-delete', branch: 'ephemeral' }));

      // Fire many reads concurrently with a delete — each read should return
      // either a valid WorkspaceState or null, never throw.
      const reads = Array.from({ length: 20 }, () => readWorkspaceState('read-delete'));
      const deleteOp = deleteWorkspaceState('read-delete');

      const results = await Promise.all([...reads, deleteOp]);

      // Last element is the delete (void). All others are WorkspaceState | null.
      for (let i = 0; i < results.length - 1; i++) {
        const result = results[i] as WorkspaceState | null;
        if (result !== null) {
          expect(result.id).toBe('read-delete');
          expect(result.branch).toBe('ephemeral');
        }
      }

      // After everything settles, the file should be gone
      expect(await readWorkspaceState('read-delete')).toBeNull();
    });

    it('listWorkspaceStates tolerates file deleted between readdir and readFile', { timeout: 30_000 }, async () => {
      // Create several workspaces, then delete one while listing
      for (let i = 0; i < 5; i++) {
        await writeWorkspaceState(makeState({ id: `list-race-${i}`, branch: `b-${i}` }));
      }

      // Race: list and delete happen concurrently
      const [states] = await Promise.all([
        listWorkspaceStates(),
        deleteWorkspaceState('list-race-2'),
      ]);

      // Should get 4 or 5 states (depending on timing), never throw
      expect(states.length).toBeGreaterThanOrEqual(4);
      expect(states.length).toBeLessThanOrEqual(5);

      // All returned states must be valid
      for (const s of states) {
        expect(s.version).toBe(1);
        expect(s.id).toMatch(/^list-race-\d$/);
      }
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
        const state = await readWorkspaceState(`ws-${i}`);
        expect(state).not.toBeNull();
        expect(state!.status).toBe(statuses[i]);
      }
    });
  });
});
