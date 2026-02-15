import { vi } from 'vitest';

/**
 * Error thrown by mocked process.exit() to interrupt control flow.
 */
export class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * Mock process.exit to throw ExitError instead of actually exiting.
 * Call this in beforeEach.
 */
export function mockProcessExit(): void {
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    throw new ExitError(typeof code === 'number' ? code : 0);
  });
}
