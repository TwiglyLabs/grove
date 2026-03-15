/**
 * Deploys service charts to the vCluster.
 *
 * Registry services: pulled from a Helm registry and deployed directly.
 * Dev services: built locally via Docker, pushed to the local registry (localhost:5001),
 * then deployed via their local Helm chart.
 */

import { execSync } from 'node:child_process';
import type { ServiceConfig, DevServiceConfig, RegistryServiceConfig } from '../vcluster-config.js';
import { isDevService } from '../vcluster-config.js';
import { printInfo, printSuccess } from '../../shared/output.js';

const LOCAL_REGISTRY = 'localhost:5001';

export interface DeployAllOptions {
  /** If set, deploy only the named services. */
  only?: string[];
}

export class ServiceDeployer {
  /**
   * Deploy a registry-sourced service.
   */
  deployRegistry(svc: RegistryServiceConfig): void {
    const versionFlag = svc.version ? `--version ${svc.version}` : '';
    const valuesFlag = svc.values ? `-f ${svc.values}` : '';

    printInfo(`Deploying service: ${svc.name}...`);
    execSync(
      `helm install ${svc.name} ${svc.chart} ${versionFlag} ${valuesFlag} --wait --timeout 5m`,
      { stdio: 'inherit' },
    );
    printSuccess(`Service deployed: ${svc.name}`);
  }

  /**
   * Build a dev service locally, push to the local registry, then deploy via Helm.
   */
  deployDev(svc: DevServiceConfig): void {
    const tag = `${svc.name}`;
    const localTag = `${LOCAL_REGISTRY}/${svc.name}:latest`;
    const valuesFlag = svc.values ? `-f ${svc.values}` : '';

    printInfo(`Building dev service: ${svc.name}...`);

    // 1. Docker build
    execSync(
      `docker build -t ${tag} -f ${svc.dockerfile} ${svc.path}`,
      { stdio: 'inherit' },
    );

    // 2. Tag and push to local registry
    execSync(`docker tag ${tag} ${localTag}`, { stdio: 'inherit' });
    execSync(`docker push ${localTag}`, { stdio: 'inherit' });

    // 3. Helm install with local image
    execSync(
      `helm install ${svc.name} ${svc.helmChart} --set image.repository=${LOCAL_REGISTRY}/${svc.name} --set image.tag=latest ${valuesFlag} --wait --timeout 5m`,
      { stdio: 'inherit' },
    );

    printSuccess(`Dev service deployed: ${svc.name}`);
  }

  /**
   * Deploy a single service (dispatches to registry or dev path).
   */
  deployOne(svc: ServiceConfig): void {
    if (isDevService(svc)) {
      this.deployDev(svc);
    } else {
      this.deployRegistry(svc as RegistryServiceConfig);
    }
  }

  /**
   * Deploy all services in parallel, optionally filtered by name.
   */
  async deployAll(services: ServiceConfig[], options?: DeployAllOptions): Promise<void> {
    if (services.length === 0) return;

    let filtered = services;
    if (options?.only && options.only.length > 0) {
      filtered = services.filter((s) => options.only!.includes(s.name));
    }

    await Promise.all(filtered.map((svc) => Promise.resolve().then(() => this.deployOne(svc))));
  }
}
