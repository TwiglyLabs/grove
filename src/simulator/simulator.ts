import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SimulatorConfig } from '../config.js';
import type { SimulatorState } from '../environment/types.js';
import { sanitizeBranchName } from '../sanitize.js';

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
}

interface SimctlDeviceList {
  devices: Record<string, SimctlDevice[]>;
}

/**
 * Find the first available base simulator from the configured device list.
 */
export function findBaseSimulator(baseDevices: string[]): { udid: string; name: string } | null {
  const output = execSync('xcrun simctl list devices available -j', {
    encoding: 'utf-8',
  });

  const deviceList: SimctlDeviceList = JSON.parse(output);

  // Flatten all devices across all iOS versions
  const allDevices: SimctlDevice[] = [];
  for (const devices of Object.values(deviceList.devices)) {
    allDevices.push(...devices);
  }

  // Try each base device in order of preference
  for (const deviceName of baseDevices) {
    const found = allDevices.find(
      (device) => device.name === deviceName && device.isAvailable
    );
    if (found) {
      return { udid: found.udid, name: found.name };
    }
  }

  return null;
}

/**
 * Find simulator by exact name match.
 */
export function findSimulatorByName(
  name: string
): { udid: string; name: string; state: string } | null {
  const output = execSync('xcrun simctl list devices -j', {
    encoding: 'utf-8',
  });

  const deviceList: SimctlDeviceList = JSON.parse(output);

  const allDevices: SimctlDevice[] = [];
  for (const devices of Object.values(deviceList.devices)) {
    allDevices.push(...devices);
  }

  const found = allDevices.find((device) => device.name === name);
  if (found) {
    return { udid: found.udid, name: found.name, state: found.state };
  }

  return null;
}

/**
 * List all simulators with the configured prefix.
 */
export function listProjectSimulators(prefix: string): Array<{
  udid: string;
  name: string;
  state: string;
}> {
  const output = execSync('xcrun simctl list devices -j', {
    encoding: 'utf-8',
  });

  const deviceList: SimctlDeviceList = JSON.parse(output);

  const allDevices: SimctlDevice[] = [];
  for (const devices of Object.values(deviceList.devices)) {
    allDevices.push(...devices);
  }

  return allDevices
    .filter((device) => device.name.startsWith(`${prefix}-`))
    .map((device) => ({
      udid: device.udid,
      name: device.name,
      state: device.state,
    }));
}

/**
 * Connect simulator to Metro by opening deep link.
 */
export function connectToMetro(udid: string, metroUrl: string, deepLinkScheme: string): void {
  const encodedUrl = encodeURIComponent(metroUrl);
  const deepLink = `${deepLinkScheme}://expo-development-client/?url=${encodedUrl}&disableOnboarding=1`;

  execSync(`xcrun simctl openurl ${udid} "${deepLink}"`, {
    encoding: 'utf-8',
  });
}

/**
 * Ensure simulator clone exists and is booted.
 */
export async function ensureSimulator(
  simulatorConfig: SimulatorConfig,
  branch: string
): Promise<SimulatorState> {
  const simulatorName = `${simulatorConfig.simulatorPrefix}-${sanitizeBranchName(branch)}`;

  // Check if simulator already exists
  let simulator = findSimulatorByName(simulatorName);

  if (!simulator) {
    // Clone from base simulator
    const base = findBaseSimulator(simulatorConfig.baseDevice);
    if (!base) {
      throw new Error(
        `No suitable base simulator found (${simulatorConfig.baseDevice.join(' or ')})`
      );
    }

    execSync(`xcrun simctl clone ${base.udid} "${simulatorName}"`, {
      encoding: 'utf-8',
    });

    simulator = findSimulatorByName(simulatorName);
    if (!simulator) {
      throw new Error(`Failed to create simulator ${simulatorName}`);
    }
  }

  // Boot if not booted
  const needsBoot = simulator.state !== 'Booted';
  if (needsBoot) {
    try {
      execSync(`xcrun simctl boot ${simulator.udid}`, { encoding: 'utf-8' });
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('current state: Booted')) {
        throw err;
      }
    }

    // Open Simulator.app in background (-g prevents focus steal)
    execSync('open -g -a Simulator', { encoding: 'utf-8' });
  }

  // Refresh simulator state
  const refreshed = findSimulatorByName(simulatorName);
  if (!refreshed) {
    throw new Error(`Simulator ${simulatorName} disappeared after boot`);
  }

  // Ensure app is installed
  if (!isAppInstalled(refreshed.udid, simulatorConfig.bundleId)) {
    await installApp(refreshed.udid, simulatorConfig.appName);
  }

  // Determine base simulator name
  const base = findBaseSimulator(simulatorConfig.baseDevice);
  const basedOn = base ? base.name : 'Unknown';

  return {
    udid: refreshed.udid,
    name: refreshed.name,
    basedOn,
    status: refreshed.state === 'Booted' ? 'booted' : 'shutdown',
  };
}

/**
 * Shutdown simulator by UDID.
 */
export async function shutdownSimulator(udid: string): Promise<void> {
  try {
    execSync(`xcrun simctl shutdown ${udid}`, { encoding: 'utf-8' });
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('Unable to shutdown device in current state: Shutdown')) {
      throw err;
    }
  }
}

/**
 * Delete simulator by UDID.
 */
export async function deleteSimulator(udid: string): Promise<void> {
  execSync(`xcrun simctl delete ${udid}`, { encoding: 'utf-8' });
}

/**
 * Check if an app is installed on the simulator.
 */
export function isAppInstalled(udid: string, bundleId: string): boolean {
  try {
    execSync(`xcrun simctl get_app_container ${udid} ${bundleId}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the most recently built simulator .app in Xcode DerivedData.
 */
export function findAppBinary(appName: string): string | null {
  const derivedData = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
  if (!fs.existsSync(derivedData)) return null;

  const candidates: { path: string; mtime: number }[] = [];

  for (const entry of fs.readdirSync(derivedData)) {
    if (!entry.startsWith(`${appName}-`)) continue;
    const appPath = path.join(
      derivedData, entry,
      'Build/Products/Debug-iphonesimulator',
      `${appName}.app`
    );
    try {
      const stat = fs.statSync(appPath);
      candidates.push({ path: appPath, mtime: stat.mtimeMs });
    } catch {
      // Build products don't exist in this DerivedData dir
    }
  }

  if (candidates.length === 0) return null;

  // Return the most recently modified build
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

/**
 * Install app on simulator.
 */
export async function installApp(udid: string, appName: string): Promise<void> {
  const appPath = findAppBinary(appName);

  if (!appPath) {
    throw new Error(
      `No ${appName}.app found in Xcode DerivedData. Build it first with: npx expo run:ios --device ${udid}`
    );
  }

  execSync(`xcrun simctl install ${udid} "${appPath}"`, { encoding: 'utf-8' });
}
