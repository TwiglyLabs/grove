/**
 * Deploys database charts (e.g. Atlas migrations) in parallel inside the vCluster.
 *
 * Each database is deployed as its own Helm release and waits for completion.
 */

import { execSync } from 'node:child_process';
import type { DatabaseConfig } from '../vcluster-config.js';
import { printInfo, printSuccess } from '../../shared/output.js';

export class DatabaseDeployer {
  /**
   * Deploy a single database chart.
   */
  deployOne(db: DatabaseConfig): void {
    const versionFlag = db.version ? `--version ${db.version}` : '';
    const valuesFlag = db.values ? `-f ${db.values}` : '';

    printInfo(`Deploying database: ${db.name}...`);
    execSync(
      `helm install ${db.name} ${db.chart} ${versionFlag} ${valuesFlag} --wait --timeout 5m`,
      { stdio: 'inherit' },
    );
    printSuccess(`Database deployed: ${db.name}`);
  }

  /**
   * Deploy all databases in parallel.
   */
  async deployAll(databases: DatabaseConfig[]): Promise<void> {
    if (databases.length === 0) return;

    await Promise.all(databases.map((db) => Promise.resolve().then(() => this.deployOne(db))));
  }
}
