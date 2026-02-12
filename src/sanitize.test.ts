import { describe, it, expect } from 'vitest';
import { sanitizeBranchName } from './sanitize.js';

describe('sanitizeBranchName', () => {
  it('converts slashes to double hyphens', () => {
    expect(sanitizeBranchName('feat/auth-fix')).toBe('feat--auth-fix');
  });

  it('preserves single hyphens (distinct from slash conversion)', () => {
    expect(sanitizeBranchName('feat-auth-fix')).toBe('feat-auth-fix');
  });

  it('handles multiple slashes', () => {
    expect(sanitizeBranchName('feature/user/auth-fix')).toBe(
      'feature--user--auth-fix'
    );
  });

  it('lowercases everything', () => {
    expect(sanitizeBranchName('CAPS/Branch')).toBe('caps--branch');
  });

  it('truncates to 50 characters', () => {
    const long =
      'feat/very-long-branch-name-that-exceeds-fifty-characters-total';
    const result = sanitizeBranchName(long);
    expect(result.length).toBeLessThanOrEqual(50);
    // Should not end with a hyphen after truncation
    expect(result).not.toMatch(/-$/);
  });

  it('strips leading hyphens', () => {
    expect(sanitizeBranchName('--leading-hyphens')).toBe('leading-hyphens');
  });

  it('strips trailing hyphens', () => {
    expect(sanitizeBranchName('trailing-hyphens--')).toBe('trailing-hyphens');
  });

  it('strips both leading and trailing hyphens', () => {
    expect(sanitizeBranchName('--both--')).toBe('both');
  });

  it('converts dots and underscores to single hyphens', () => {
    expect(sanitizeBranchName('feat.new_process')).toBe('feat-new-process');
  });

  it('removes other special characters', () => {
    expect(sanitizeBranchName('feat@#$%^&*branch')).toBe('feat-branch');
  });

  it('collapses consecutive hyphens from special chars (but not from slashes)', () => {
    // Special chars next to each other → single hyphen
    expect(sanitizeBranchName('a..b')).toBe('a-b');
    // But slashes always produce exactly --
    expect(sanitizeBranchName('a/b')).toBe('a--b');
  });

  it('handles empty string', () => {
    expect(sanitizeBranchName('')).toBe('');
  });

  it('handles string of only special characters', () => {
    expect(sanitizeBranchName('////')).toBe('');
  });

  it('ensures collision resistance between known confusable pairs', () => {
    // These must produce DIFFERENT outputs
    const pairs = [
      ['feat/auth-fix', 'feat-auth-fix'],
      ['feat/auth/fix', 'feat-auth-fix'],
      ['a/b', 'a-b'],
      ['a/b/c', 'a-b-c'],
    ];

    for (const [a, b] of pairs) {
      const sa = sanitizeBranchName(a);
      const sb = sanitizeBranchName(b);
      expect(sa).not.toBe(sb);
    }
  });

  it('produces valid k8s label values (alphanumeric + hyphens)', () => {
    const inputs = [
      'feat/auth-fix',
      'CAPS/Branch',
      'feat.new_process',
      'release/v1.2.3',
      'user@company/task#123',
    ];

    for (const input of inputs) {
      const result = sanitizeBranchName(input);
      expect(result).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    }
  });
});
