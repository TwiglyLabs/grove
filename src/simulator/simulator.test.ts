import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimulatorConfig } from './config.js';

const { mockExecSync, mockExistsSync, mockReaddirSync, mockStatSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockStatSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readdirSync: mockReaddirSync,
      statSync: mockStatSync,
    },
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    statSync: mockStatSync,
  };
});

vi.mock('os', () => ({
  default: { homedir: () => '/Users/testuser' },
  homedir: () => '/Users/testuser',
}));

import {
  findBaseSimulator,
  findSimulatorByName,
  listProjectSimulators,
  connectToMetro,
  ensureSimulator,
  shutdownSimulator,
  deleteSimulator,
  findAppBinary,
  installApp,
  isAppInstalled,
} from './simulator.js';

const testConfig: SimulatorConfig = {
  platform: 'ios',
  bundleId: 'com.testapp.app',
  appName: 'TestApp',
  simulatorPrefix: 'TestApp',
  baseDevice: ['iPhone 15 Pro', 'iPhone 16 Pro'],
  deepLinkScheme: 'testapp',
  metroFrontend: 'mobile',
};

describe('simulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  describe('findBaseSimulator', () => {
    it('finds first preferred device from config baseDevice list', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 17.2': [
            { udid: 'A1B2C3D4', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true },
            { udid: 'E5F6G7H8', name: 'iPhone 14', state: 'Shutdown', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = findBaseSimulator(testConfig.baseDevice);

      expect(result).toEqual({ udid: 'A1B2C3D4', name: 'iPhone 15 Pro' });
    });

    it('falls back to second device if first not available', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 18.0': [
            { udid: 'F1F2F3F4', name: 'iPhone 16 Pro', state: 'Shutdown', isAvailable: true },
            { udid: 'G1G2G3G4', name: 'iPhone 14', state: 'Shutdown', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = findBaseSimulator(testConfig.baseDevice);

      expect(result).toEqual({ udid: 'F1F2F3F4', name: 'iPhone 16 Pro' });
    });

    it('returns null when no suitable simulators available', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 17.2': [
            { udid: 'X1X2X3X4', name: 'iPhone 14', state: 'Shutdown', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = findBaseSimulator(testConfig.baseDevice);

      expect(result).toBeNull();
    });

    it('returns null when device list is empty', () => {
      mockExecSync.mockReturnValueOnce(JSON.stringify({ devices: {} }));

      const result = findBaseSimulator(testConfig.baseDevice);

      expect(result).toBeNull();
    });
  });

  describe('listProjectSimulators', () => {
    it('returns only simulators with the configured prefix', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 17.2': [
            { udid: 'A1A1A1A1', name: 'TestApp-feat-auth', state: 'Booted', isAvailable: true },
            { udid: 'B2B2B2B2', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true },
            { udid: 'C3C3C3C3', name: 'TestApp-mobile-e2e', state: 'Shutdown', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = listProjectSimulators(testConfig.simulatorPrefix);

      expect(result).toEqual([
        { udid: 'A1A1A1A1', name: 'TestApp-feat-auth', state: 'Booted' },
        { udid: 'C3C3C3C3', name: 'TestApp-mobile-e2e', state: 'Shutdown' },
      ]);
    });

    it('returns empty array when no matching simulators exist', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 17.2': [
            { udid: 'X1X1X1X1', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = listProjectSimulators(testConfig.simulatorPrefix);

      expect(result).toEqual([]);
    });
  });

  describe('findSimulatorByName', () => {
    it('finds simulator by exact name match', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 17.2': [
            { udid: 'A1A1A1A1', name: 'TestApp-feat-auth', state: 'Booted', isAvailable: true },
            { udid: 'B2B2B2B2', name: 'TestApp-mobile', state: 'Shutdown', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = findSimulatorByName('TestApp-feat-auth');

      expect(result).toEqual({
        udid: 'A1A1A1A1',
        name: 'TestApp-feat-auth',
        state: 'Booted',
      });
    });

    it('returns null when simulator not found', () => {
      const deviceListOutput = JSON.stringify({
        devices: {
          'iOS 17.2': [
            { udid: 'A1A1A1A1', name: 'TestApp-feat-auth', state: 'Booted', isAvailable: true },
          ],
        },
      });

      mockExecSync.mockReturnValueOnce(deviceListOutput);

      const result = findSimulatorByName('TestApp-nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('connectToMetro', () => {
    it('sends correct deep link URL with configured scheme', () => {
      const udid = 'A1A1A1A1';
      const metroUrl = 'http://192.168.1.100:18097';
      const encodedUrl = encodeURIComponent(metroUrl);
      const expectedDeepLink = `testapp://expo-development-client/?url=${encodedUrl}&disableOnboarding=1`;

      connectToMetro(udid, metroUrl, testConfig.deepLinkScheme);

      expect(mockExecSync).toHaveBeenCalledWith(
        `xcrun simctl openurl ${udid} "${expectedDeepLink}"`,
        { encoding: 'utf-8' }
      );
    });

    it('handles Metro URLs with special characters', () => {
      const udid = 'B2B2B2B2';
      const metroUrl = 'http://192.168.1.100:18097?foo=bar&baz=qux';
      const encodedUrl = encodeURIComponent(metroUrl);
      const expectedDeepLink = `testapp://expo-development-client/?url=${encodedUrl}&disableOnboarding=1`;

      connectToMetro(udid, metroUrl, testConfig.deepLinkScheme);

      expect(mockExecSync).toHaveBeenCalledWith(
        `xcrun simctl openurl ${udid} "${expectedDeepLink}"`,
        { encoding: 'utf-8' }
      );
    });
  });

  describe('ensureSimulator', () => {
    it('creates a new clone when simulator does not exist', async () => {
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [] } })) // findSimulatorByName → not found
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'base-udid', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true }] } })) // findBaseSimulator
        .mockReturnValueOnce('') // clone command
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'clone-udid', name: 'TestApp-test-branch', state: 'Shutdown', isAvailable: true }] } })) // findSimulatorByName after clone
        .mockReturnValueOnce('') // boot command
        .mockReturnValueOnce('') // open -g Simulator.app
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'clone-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } })) // refresh state
        .mockReturnValueOnce('/path/to/app') // isAppInstalled → installed
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'base-udid', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true }] } })); // findBaseSimulator for basedOn

      const result = await ensureSimulator(testConfig, 'test-branch');

      expect(result.udid).toBe('clone-udid');
      expect(result.name).toBe('TestApp-test-branch');
      expect(result.basedOn).toBe('iPhone 15 Pro');
      expect(result.status).toBe('booted');
      expect(mockExecSync).toHaveBeenCalledWith('open -g -a Simulator', { encoding: 'utf-8' });
    });

    it('reuses existing clone when simulator already exists and is booted', async () => {
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce('/path/to/app') // isAppInstalled → already installed
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'base-udid', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true }] } }));

      const result = await ensureSimulator(testConfig, 'test-branch');

      expect(result.udid).toBe('existing-udid');
      expect(result.status).toBe('booted');
      expect(mockExecSync).not.toHaveBeenCalledWith(expect.stringContaining('simctl clone'), expect.any(Object));
      expect(mockExecSync).not.toHaveBeenCalledWith(expect.stringContaining('simctl boot'), expect.any(Object));
    });

    it('boots existing clone when simulator exists but is shutdown', async () => {
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Shutdown', isAvailable: true }] } }))
        .mockReturnValueOnce('') // boot
        .mockReturnValueOnce('') // open -g Simulator.app
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce('/path/to/app') // isAppInstalled
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'base-udid', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true }] } }));

      const result = await ensureSimulator(testConfig, 'test-branch');

      expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('simctl boot'), expect.any(Object));
      expect(mockExecSync).toHaveBeenCalledWith('open -g -a Simulator', { encoding: 'utf-8' });
      expect(result.status).toBe('booted');
    });

    it('throws when no base simulator is available for cloning', async () => {
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [] } })) // findSimulatorByName → not found
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'x', name: 'iPhone 14', state: 'Shutdown', isAvailable: true }] } })); // findBaseSimulator → no match

      await expect(ensureSimulator(testConfig, 'test-branch')).rejects.toThrow('No suitable base simulator');
    });

    it('installs app when not already installed', async () => {
      mockReaddirSync.mockReturnValue(['TestApp-abc123']);
      mockStatSync.mockReturnValue({ mtimeMs: 1000 });
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockImplementationOnce(() => { throw new Error('No such app'); }) // isAppInstalled → not installed
        .mockReturnValueOnce('') // xcrun simctl install
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'base-udid', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true }] } }));

      await ensureSimulator(testConfig, 'test-branch');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/xcrun simctl install existing-udid.*TestApp\.app/),
        { encoding: 'utf-8' }
      );
    });

    it('skips install when app already installed', async () => {
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce('/path/to/app') // isAppInstalled → already installed
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'base-udid', name: 'iPhone 15 Pro', state: 'Shutdown', isAvailable: true }] } }));

      await ensureSimulator(testConfig, 'test-branch');

      expect(mockExecSync).not.toHaveBeenCalledWith(
        expect.stringContaining('simctl install'),
        expect.any(Object)
      );
    });

    it('throws helpful error when app not installed AND no binary in DerivedData', async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockReturnValueOnce(JSON.stringify({ devices: { 'iOS 17.2': [{ udid: 'existing-udid', name: 'TestApp-test-branch', state: 'Booted', isAvailable: true }] } }))
        .mockImplementationOnce(() => { throw new Error('No such app'); });

      await expect(ensureSimulator(testConfig, 'test-branch')).rejects.toThrow(/No TestApp\.app found/);
    });
  });

  describe('shutdownSimulator', () => {
    it('calls xcrun simctl shutdown', async () => {
      mockExecSync.mockReturnValueOnce('');
      await shutdownSimulator('test-udid');
      expect(mockExecSync).toHaveBeenCalledWith('xcrun simctl shutdown test-udid', { encoding: 'utf-8' });
    });

    it('ignores already-shutdown error', async () => {
      const error = new Error('Unable to shutdown device in current state: Shutdown');
      mockExecSync.mockImplementationOnce(() => { throw error; });
      await expect(shutdownSimulator('test-udid')).resolves.toBeUndefined();
    });
  });

  describe('deleteSimulator', () => {
    it('calls xcrun simctl delete', async () => {
      mockExecSync.mockReturnValueOnce('');
      await deleteSimulator('test-udid');
      expect(mockExecSync).toHaveBeenCalledWith('xcrun simctl delete test-udid', { encoding: 'utf-8' });
    });
  });

  describe('isAppInstalled', () => {
    it('returns true when get_app_container succeeds', () => {
      mockExecSync.mockReturnValueOnce('/path/to/app');
      expect(isAppInstalled('test-udid', testConfig.bundleId)).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining(`get_app_container test-udid ${testConfig.bundleId}`),
        expect.objectContaining({ encoding: 'utf-8' })
      );
    });

    it('returns false when get_app_container throws', () => {
      mockExecSync.mockImplementationOnce(() => { throw new Error('No such app'); });
      expect(isAppInstalled('test-udid', testConfig.bundleId)).toBe(false);
    });
  });

  describe('findAppBinary', () => {
    it('returns most recent build from DerivedData', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['TestApp-abc123', 'TestApp-def456', 'OtherProject-xyz']);
      mockStatSync
        .mockReturnValueOnce({ mtimeMs: 1000 })
        .mockReturnValueOnce({ mtimeMs: 2000 });
      const result = findAppBinary(testConfig.appName);
      expect(result).toContain('TestApp-def456');
      expect(result).toContain('TestApp.app');
    });

    it('returns null when DerivedData does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(findAppBinary(testConfig.appName)).toBeNull();
    });

    it('returns null when no matching builds exist', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['OtherProject-xyz']);
      expect(findAppBinary(testConfig.appName)).toBeNull();
    });

    it('skips entries where build products are missing', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['TestApp-abc123']);
      mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
      expect(findAppBinary(testConfig.appName)).toBeNull();
    });
  });

  describe('installApp', () => {
    it('calls xcrun simctl install when binary found in DerivedData', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['TestApp-abc123']);
      mockStatSync.mockReturnValue({ mtimeMs: 1000 });
      mockExecSync.mockReturnValueOnce('');
      await installApp('test-udid', testConfig.appName);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringMatching(/xcrun simctl install test-udid.*TestApp\.app/),
        { encoding: 'utf-8' }
      );
    });

    it('throws with helpful message when no binary found', async () => {
      mockExistsSync.mockReturnValue(false);
      await expect(installApp('test-udid', testConfig.appName)).rejects.toThrow(
        /No TestApp\.app found/
      );
      await expect(installApp('test-udid', testConfig.appName)).rejects.toThrow(
        /npx expo run:ios/
      );
    });
  });
});
