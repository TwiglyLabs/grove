import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerCleanupHandler, unregisterCleanupHandler } from './signals.js';
import type { RepoId } from '../shared/identity.js';
import { asRepoId } from '../shared/identity.js';

const testRepoId = asRepoId('repo_test123');

describe('signal handlers', () => {
  let originalListenerCount: number;

  beforeEach(() => {
    originalListenerCount = process.listenerCount('SIGINT');
  });

  afterEach(() => {
    unregisterCleanupHandler();
  });

  it('registers SIGINT and SIGTERM listeners', () => {
    const downFn = vi.fn().mockResolvedValue(undefined);
    registerCleanupHandler(downFn, testRepoId);

    expect(process.listenerCount('SIGINT')).toBe(originalListenerCount + 1);
    expect(process.listenerCount('SIGTERM')).toBe(originalListenerCount + 1);
  });

  it('unregisters listeners on unregisterCleanupHandler', () => {
    const downFn = vi.fn().mockResolvedValue(undefined);
    registerCleanupHandler(downFn, testRepoId);
    unregisterCleanupHandler();

    expect(process.listenerCount('SIGINT')).toBe(originalListenerCount);
    expect(process.listenerCount('SIGTERM')).toBe(originalListenerCount);
  });

  it('replaces previous handler on re-register', () => {
    const downFn1 = vi.fn().mockResolvedValue(undefined);
    const downFn2 = vi.fn().mockResolvedValue(undefined);

    registerCleanupHandler(downFn1, testRepoId);
    registerCleanupHandler(downFn2, testRepoId);

    // Should only have one set of listeners
    expect(process.listenerCount('SIGINT')).toBe(originalListenerCount + 1);
    expect(process.listenerCount('SIGTERM')).toBe(originalListenerCount + 1);
  });

  it('double unregister is safe', () => {
    const downFn = vi.fn().mockResolvedValue(undefined);
    registerCleanupHandler(downFn, testRepoId);
    unregisterCleanupHandler();
    unregisterCleanupHandler(); // Should not throw

    expect(process.listenerCount('SIGINT')).toBe(originalListenerCount);
  });
});
