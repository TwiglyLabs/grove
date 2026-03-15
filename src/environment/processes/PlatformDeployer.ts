/**
 * Deploys the platform Helm chart (Kong, Dapr, infra) inside the vCluster.
 *
 * Installs if not present, upgrades if already installed.
 */

import { execSync } from 'node:child_process';
import type { PlatformConfig } from '../vcluster-config.js';

export class PlatformDeployer {
  /**
   * Install the platform chart. Use when it is not yet installed.
   */
  install(config: PlatformConfig): void {
    const versionFlag = config.version ? `--version ${config.version}` : '';
    const valuesFlag = config.values ? `-f ${config.values}` : '';
    execSync(
      `helm install platform ${config.chart} ${versionFlag} ${valuesFlag} --wait --timeout 5m`,
      { stdio: 'inherit' },
    );
  }

  /**
   * Upgrade an already-installed platform chart.
   */
  upgrade(config: PlatformConfig): void {
    const versionFlag = config.version ? `--version ${config.version}` : '';
    const valuesFlag = config.values ? `-f ${config.values}` : '';
    execSync(
      `helm upgrade platform ${config.chart} ${versionFlag} ${valuesFlag} --wait --timeout 5m`,
      { stdio: 'inherit' },
    );
  }

  /**
   * Check whether the platform release is already installed.
   */
  isInstalled(): boolean {
    try {
      execSync('helm status platform', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Install or upgrade the platform chart depending on current state.
   */
  ensure(config: PlatformConfig): void {
    if (this.isInstalled()) {
      this.upgrade(config);
    } else {
      this.install(config);
    }
  }
}
