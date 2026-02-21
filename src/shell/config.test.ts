import { describe, it, expect } from 'vitest';
import { ShellTargetSchema, ShellTargetsSchema } from './config.js';

describe('shell config schemas', () => {
  describe('ShellTargetSchema', () => {
    it('parses minimal target (name only)', () => {
      const result = ShellTargetSchema.parse({ name: 'api' });
      expect(result.name).toBe('api');
      expect(result.podSelector).toBeUndefined();
      expect(result.shell).toBeUndefined();
    });

    it('parses target with podSelector', () => {
      const result = ShellTargetSchema.parse({
        name: 'auth',
        podSelector: 'component=auth-server',
      });
      expect(result.name).toBe('auth');
      expect(result.podSelector).toBe('component=auth-server');
    });

    it('parses target with custom shell', () => {
      const result = ShellTargetSchema.parse({
        name: 'worker',
        shell: '/bin/bash',
      });
      expect(result.shell).toBe('/bin/bash');
    });

    it('parses target with all fields', () => {
      const result = ShellTargetSchema.parse({
        name: 'db',
        podSelector: 'app=postgres',
        shell: '/bin/bash',
      });
      expect(result.name).toBe('db');
      expect(result.podSelector).toBe('app=postgres');
      expect(result.shell).toBe('/bin/bash');
    });

    it('rejects missing name', () => {
      expect(() => ShellTargetSchema.parse({})).toThrow();
    });
  });

  describe('ShellTargetsSchema', () => {
    it('parses array of targets', () => {
      const result = ShellTargetsSchema.parse([
        { name: 'api' },
        { name: 'worker', shell: '/bin/bash' },
      ]);
      expect(result).toHaveLength(2);
    });

    it('accepts undefined (optional)', () => {
      const result = ShellTargetsSchema.parse(undefined);
      expect(result).toBeUndefined();
    });

    it('parses empty array', () => {
      const result = ShellTargetsSchema.parse([]);
      expect(result).toEqual([]);
    });
  });
});
