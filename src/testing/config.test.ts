import { describe, it, expect } from 'vitest';
import {
  TestSuiteSchema,
  MobileTestingSchema,
  PlatformTestingSchema,
  ObservabilitySchema,
  TestingSchema,
} from './config.js';

describe('testing config schemas', () => {
  describe('TestSuiteSchema', () => {
    it('parses valid suite', () => {
      const result = TestSuiteSchema.parse({ name: 'smoke', paths: ['tests/smoke'] });
      expect(result.name).toBe('smoke');
      expect(result.paths).toEqual(['tests/smoke']);
    });

    it('rejects missing name', () => {
      expect(() => TestSuiteSchema.parse({ paths: ['tests/'] })).toThrow();
    });

    it('rejects missing paths', () => {
      expect(() => TestSuiteSchema.parse({ name: 'smoke' })).toThrow();
    });
  });

  describe('MobileTestingSchema', () => {
    it('parses minimal config', () => {
      const result = MobileTestingSchema.parse({ basePath: 'tests/mobile' });
      expect(result.runner).toBe('maestro');
      expect(result.basePath).toBe('tests/mobile');
    });

    it('applies defaults', () => {
      const result = MobileTestingSchema.parse({ basePath: 'tests/mobile' });
      expect(result.runner).toBe('maestro');
    });

    it('accepts optional suites and envVars', () => {
      const result = MobileTestingSchema.parse({
        basePath: 'tests/mobile',
        suites: [{ name: 'smoke', paths: ['flows/smoke'] }],
        envVars: { APP_ENV: 'test' },
      });
      expect(result.suites).toHaveLength(1);
      expect(result.envVars).toEqual({ APP_ENV: 'test' });
    });
  });

  describe('PlatformTestingSchema', () => {
    it('parses valid config', () => {
      const result = PlatformTestingSchema.parse({ runner: 'jest', cwd: 'packages/api' });
      expect(result.runner).toBe('jest');
      expect(result.cwd).toBe('packages/api');
    });

    it('rejects missing runner', () => {
      expect(() => PlatformTestingSchema.parse({ cwd: 'packages/api' })).toThrow();
    });

    it('accepts optional envVars', () => {
      const result = PlatformTestingSchema.parse({
        runner: 'playwright',
        cwd: 'packages/webapp',
        envVars: { BASE_URL: 'http://localhost:3000' },
      });
      expect(result.envVars).toEqual({ BASE_URL: 'http://localhost:3000' });
    });
  });

  describe('ObservabilitySchema', () => {
    it('parses minimal config', () => {
      const result = ObservabilitySchema.parse({ serviceName: 'my-app' });
      expect(result.serviceName).toBe('my-app');
      expect(result.traceEndpoint).toBeUndefined();
    });

    it('accepts optional traceEndpoint', () => {
      const result = ObservabilitySchema.parse({
        serviceName: 'my-app',
        traceEndpoint: 'http://jaeger:4317',
      });
      expect(result.traceEndpoint).toBe('http://jaeger:4317');
    });
  });

  describe('TestingSchema', () => {
    it('parses empty config with defaults', () => {
      const result = TestingSchema.parse({});
      expect(result.historyDir).toBe('.grove/test-history');
      expect(result.historyLimit).toBe(10);
      expect(result.defaultTimeout).toBe(300000);
      expect(result.mobile).toBeUndefined();
      expect(result.webapp).toBeUndefined();
      expect(result.api).toBeUndefined();
    });

    it('parses full config', () => {
      const result = TestingSchema.parse({
        mobile: { basePath: 'tests/mobile' },
        webapp: { runner: 'playwright', cwd: 'packages/webapp' },
        api: { runner: 'jest', cwd: 'packages/api' },
        observability: { serviceName: 'my-app' },
        historyDir: '.grove/custom-history',
        historyLimit: 20,
        defaultTimeout: 600000,
      });
      expect(result.mobile?.basePath).toBe('tests/mobile');
      expect(result.webapp?.runner).toBe('playwright');
      expect(result.api?.runner).toBe('jest');
      expect(result.historyDir).toBe('.grove/custom-history');
      expect(result.historyLimit).toBe(20);
      expect(result.defaultTimeout).toBe(600000);
    });
  });
});
