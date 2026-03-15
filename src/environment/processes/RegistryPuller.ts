import { execSync } from 'child_process';
import type { GroveConfig } from '../../config.js';
import type { ClusterProvider } from '../types.js';
import { RegistryPullFailedError } from '../../shared/errors.js';
import { printInfo, printSuccess, printWarning } from '../../shared/output.js';

export interface RegistryPullOptions {
  forcePull?: boolean;
}

export class RegistryPuller {
  private registry: string;

  constructor(
    private config: GroveConfig,
    private provider: ClusterProvider,
  ) {
    if (!config.project.registry) {
      throw new RegistryPullFailedError('(unknown)', 'No registry configured in project config');
    }
    this.registry = config.project.registry;
  }

  imageExistsLocally(image: string): boolean {
    try {
      execSync(`docker image inspect ${image}`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  pullAndLoad(service: string, image: string, options?: RegistryPullOptions): void {
    const registryImage = `${this.registry}/${image}`;
    const localImage = image;

    // Smart pull: skip if image already exists locally (unless forcePull)
    if (!options?.forcePull && this.imageExistsLocally(localImage)) {
      printInfo(`Skipping ${service} — image already exists locally`);
      return;
    }

    printInfo(`Pulling ${service} from registry...`);

    try {
      execSync(`docker pull ${registryImage}`, { stdio: 'inherit' });
    } catch (error) {
      throw new RegistryPullFailedError(service, error);
    }

    // Re-tag to local image name
    try {
      execSync(`docker tag ${registryImage} ${localImage}`, { stdio: 'inherit' });
    } catch (error) {
      throw new RegistryPullFailedError(service, `Failed to re-tag: ${error}`);
    }

    // Load into cluster
    const clusterName = this.config.project.cluster;
    this.provider.loadImage(localImage, clusterName);

    printSuccess(`Pulled and loaded ${service}`);
  }

  pullAllNonDev(devServices: string[], options?: RegistryPullOptions): void {
    for (const service of this.config.services) {
      if (!service.build) continue;
      if (devServices.includes(service.name)) continue;

      try {
        this.pullAndLoad(service.name, service.build.image, options);
      } catch (error) {
        // Non-fatal: warn and continue (matches pull-backend.sh behavior)
        const message = error instanceof RegistryPullFailedError ? error.message : String(error);
        printWarning(`${message} — continuing`);
      }
    }
  }
}
