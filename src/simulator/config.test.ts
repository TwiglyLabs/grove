import { describe, it, expect } from 'vitest';
import { SimulatorSchema } from './config.js';

describe('simulator config schema', () => {
  const validConfig = {
    bundleId: 'com.example.app',
    appName: 'MyApp',
    simulatorPrefix: 'myapp',
    baseDevice: ['iPhone 15'],
    deepLinkScheme: 'myapp',
    metroFrontend: 'mobile',
  };

  it('parses valid config with defaults', () => {
    const result = SimulatorSchema.parse(validConfig);
    expect(result.platform).toBe('ios');
    expect(result.bundleId).toBe('com.example.app');
    expect(result.appName).toBe('MyApp');
    expect(result.simulatorPrefix).toBe('myapp');
    expect(result.baseDevice).toEqual(['iPhone 15']);
    expect(result.deepLinkScheme).toBe('myapp');
    expect(result.metroFrontend).toBe('mobile');
  });

  it('defaults platform to ios', () => {
    const result = SimulatorSchema.parse(validConfig);
    expect(result.platform).toBe('ios');
  });

  it('accepts explicit platform', () => {
    const result = SimulatorSchema.parse({ ...validConfig, platform: 'ios' });
    expect(result.platform).toBe('ios');
  });

  it('rejects invalid platform', () => {
    expect(() => SimulatorSchema.parse({ ...validConfig, platform: 'android' })).toThrow();
  });

  it('accepts multiple base devices', () => {
    const result = SimulatorSchema.parse({
      ...validConfig,
      baseDevice: ['iPhone 15', 'iPhone 15 Pro'],
    });
    expect(result.baseDevice).toHaveLength(2);
  });

  it('rejects missing bundleId', () => {
    const { bundleId, ...rest } = validConfig;
    expect(() => SimulatorSchema.parse(rest)).toThrow();
  });

  it('rejects missing appName', () => {
    const { appName, ...rest } = validConfig;
    expect(() => SimulatorSchema.parse(rest)).toThrow();
  });

  it('rejects missing simulatorPrefix', () => {
    const { simulatorPrefix, ...rest } = validConfig;
    expect(() => SimulatorSchema.parse(rest)).toThrow();
  });

  it('rejects missing baseDevice', () => {
    const { baseDevice, ...rest } = validConfig;
    expect(() => SimulatorSchema.parse(rest)).toThrow();
  });

  it('rejects missing deepLinkScheme', () => {
    const { deepLinkScheme, ...rest } = validConfig;
    expect(() => SimulatorSchema.parse(rest)).toThrow();
  });

  it('rejects missing metroFrontend', () => {
    const { metroFrontend, ...rest } = validConfig;
    expect(() => SimulatorSchema.parse(rest)).toThrow();
  });
});
