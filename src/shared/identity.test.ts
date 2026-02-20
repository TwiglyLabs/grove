import { describe, it, expect } from 'vitest';
import { createRepoId, isRepoId, asRepoId, asWorkspaceId } from './identity.js';

describe('createRepoId', () => {
  it('returns a string starting with repo_', () => {
    const id = createRepoId();
    expect(id).toMatch(/^repo_/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createRepoId()));
    expect(ids.size).toBe(100);
  });

  it('generates IDs with expected length', () => {
    const id = createRepoId();
    // "repo_" (5 chars) + 12 char nanoid
    expect(id.length).toBe(17);
  });
});

describe('isRepoId', () => {
  it('returns true for valid repo IDs', () => {
    expect(isRepoId('repo_abc123def456')).toBe(true);
    expect(isRepoId('repo_')).toBe(true);
  });

  it('returns false for non-repo strings', () => {
    expect(isRepoId('workspace_abc')).toBe(false);
    expect(isRepoId('abc123')).toBe(false);
    expect(isRepoId('')).toBe(false);
    expect(isRepoId('REPO_abc')).toBe(false);
  });
});

describe('asRepoId', () => {
  it('returns the value for valid repo IDs', () => {
    const id = asRepoId('repo_abc123def456');
    expect(id).toBe('repo_abc123def456');
  });

  it('throws for invalid repo IDs', () => {
    expect(() => asRepoId('not-a-repo-id')).toThrow('Invalid RepoId');
    expect(() => asRepoId('')).toThrow('Invalid RepoId');
  });
});

describe('asWorkspaceId', () => {
  it('returns the value cast as WorkspaceId', () => {
    const id = asWorkspaceId('myproject-feature-x');
    expect(id).toBe('myproject-feature-x');
  });
});
