import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { WorkspaceState } from './types.js';

// Override STATE_DIR for testing via module mock
const testDir = join(tmpdir(), `grove-test-${process.pid}`);

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => testDir,
  };
});

const { readWorkspaceState, writeWorkspaceState, deleteWorkspaceState, listWorkspaceStates, findWorkspaceByBranch, getStateDir } = await import('./state.js');

function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    version: 1,
    id: 'myproject-feature-x',
    status: 'active',
    branch: 'feature-x',
    createdAt: '2026-02-13T10:00:00Z',
    updatedAt: '2026-02-13T14:00:00Z',
    root: '/tmp/worktrees/myproject/feature-x',
    source: '/tmp/repos/myproject',
    repos: [
      {
        name: 'myproject',
        role: 'parent',
        source: '/tmp/repos/myproject',
        worktree: '/tmp/worktrees/myproject/feature-x',
        parentBranch: 'main',
      },
    ],
    sync: null,
    ...overrides,
  };
}

describe('getStateDir', () => {
  afterEach(() => {
    delete process.env.GROVE_STATE_DIR;
  });

  it('returns default path when GROVE_STATE_DIR not set', () => {
    delete process.env.GROVE_STATE_DIR;
    expect(getStateDir()).toBe(join(testDir, '.grove', 'workspaces'));
  });

  it('returns GROVE_STATE_DIR when set', () => {
    process.env.GROVE_STATE_DIR = '/custom/state/path';
    expect(getStateDir()).toBe('/custom/state/path');
  });
});

describe('workspace state', () => {
  beforeEach(() => {
    delete process.env.GROVE_STATE_DIR;
    mkdirSync(join(testDir, '.grove', 'workspaces'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('writeWorkspaceState + readWorkspaceState', () => {
    it('round-trips state through write and read', async () => {
      const state = makeState();
      await writeWorkspaceState(state);

      const loaded = readWorkspaceState('myproject-feature-x');
      expect(loaded).toEqual(state);
    });

    it('overwrites existing state', async () => {
      const state = makeState();
      await writeWorkspaceState(state);

      const updated = makeState({ status: 'closing', updatedAt: '2026-02-14T10:00:00Z' });
      await writeWorkspaceState(updated);

      const loaded = readWorkspaceState('myproject-feature-x');
      expect(loaded?.status).toBe('closing');
    });

    it('writes state with sync progress', async () => {
      const state = makeState({
        sync: {
          startedAt: '2026-02-13T12:00:00Z',
          repos: {
            myproject: 'synced',
            public: 'conflicted',
            cloud: 'pending',
          },
        },
      });
      await writeWorkspaceState(state);

      const loaded = readWorkspaceState('myproject-feature-x');
      expect(loaded?.sync).toEqual(state.sync);
    });
  });

  describe('readWorkspaceState', () => {
    it('returns null for non-existent state', () => {
      expect(readWorkspaceState('nonexistent')).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const filePath = join(testDir, '.grove', 'workspaces', 'bad.json');
      writeFileSync(filePath, 'not valid json', 'utf-8');
      expect(readWorkspaceState('bad')).toBeNull();
    });

    it('returns null for invalid schema', () => {
      const filePath = join(testDir, '.grove', 'workspaces', 'invalid.json');
      writeFileSync(filePath, JSON.stringify({ version: 2, wrong: true }), 'utf-8');
      expect(readWorkspaceState('invalid')).toBeNull();
    });
  });

  describe('deleteWorkspaceState', () => {
    it('deletes existing state file', async () => {
      await writeWorkspaceState(makeState());
      expect(readWorkspaceState('myproject-feature-x')).not.toBeNull();

      deleteWorkspaceState('myproject-feature-x');
      expect(readWorkspaceState('myproject-feature-x')).toBeNull();
    });

    it('does nothing for non-existent state', () => {
      expect(() => deleteWorkspaceState('nonexistent')).not.toThrow();
    });
  });

  describe('listWorkspaceStates', () => {
    it('returns empty array when no states exist', () => {
      expect(listWorkspaceStates()).toEqual([]);
    });

    it('returns all valid states', async () => {
      await writeWorkspaceState(makeState({ id: 'proj-a', branch: 'a' }));
      await writeWorkspaceState(makeState({ id: 'proj-b', branch: 'b' }));

      const states = listWorkspaceStates();
      expect(states).toHaveLength(2);
      expect(states.map(s => s.id).sort()).toEqual(['proj-a', 'proj-b']);
    });

    it('skips invalid state files', async () => {
      await writeWorkspaceState(makeState({ id: 'valid' }));
      const badPath = join(testDir, '.grove', 'workspaces', 'bad.json');
      writeFileSync(badPath, 'invalid json', 'utf-8');

      const states = listWorkspaceStates();
      expect(states).toHaveLength(1);
      expect(states[0].id).toBe('valid');
    });
  });

  describe('findWorkspaceByBranch', () => {
    it('finds workspace matching branch', async () => {
      await writeWorkspaceState(makeState({ id: 'proj-feature', branch: 'feature' }));

      const found = findWorkspaceByBranch('feature');
      expect(found).not.toBeNull();
      expect(found?.id).toBe('proj-feature');
    });

    it('returns null when no match', async () => {
      await writeWorkspaceState(makeState({ id: 'proj-other', branch: 'other' }));
      expect(findWorkspaceByBranch('nonexistent')).toBeNull();
    });
  });
});
