import { execSync } from 'child_process';
import { join } from 'path';
import type { GroveConfig, Service } from '../../config.js';
import type { ClusterProvider, EnvironmentState } from '../types.js';
import { printInfo, printSuccess } from '../../shared/output.js';
import { BuildFailedError, ImageLoadFailedError, DeploymentFailedError } from '../../shared/errors.js';
import { RegistryPuller } from './RegistryPuller.js';

export interface BuildAndDeployOptions {
  devServices?: string[];
  forcePull?: boolean;
}

export class BuildOrchestrator {
  constructor(
    private config: GroveConfig,
    private state: EnvironmentState,
    private provider: ClusterProvider,
  ) {}

  buildService(service: Service): void {
    if (!service.build) {
      return;
    }

    printInfo(`Building ${service.name}...`);

    const { image, dockerfile, args, secrets } = service.build;
    const dockerfilePath = join(this.config.repoRoot, dockerfile);

    const buildArgs = args
      ? Object.entries(args).map(([k, v]) => `--build-arg ${k}=${v}`).join(' ')
      : '';

    const secretFlags = secrets
      ? Object.entries(secrets)
          .map(([id, src]) => `--secret id=${id},src=${join(this.config.repoRoot, src)}`)
          .join(' ')
      : '';

    // DOCKER_BUILDKIT=1 required for --secret support
    // Use --network=host for Colima VZ driver (bridge network can't route to internet)
    const buildCmd = `DOCKER_BUILDKIT=1 docker build --network=host -t ${image} -f ${dockerfilePath} ${buildArgs} ${secretFlags} ${this.config.repoRoot}`;

    try {
      execSync(buildCmd, { stdio: 'inherit' });
      printSuccess(`Built ${service.name}`);
    } catch (error) {
      throw new BuildFailedError(service.name, error);
    }
  }

  buildAllServices(): void {
    for (const service of this.config.services) {
      if (service.build) {
        this.buildService(service);
      }
    }
  }

  loadImage(service: Service): void {
    if (!service.build) {
      return;
    }

    printInfo(`Loading ${service.name} image to ${this.provider.type}...`);

    const { image } = service.build;
    const clusterName = this.config.project.cluster;

    try {
      this.provider.loadImage(image, clusterName);
      printSuccess(`Loaded ${service.name} to ${this.provider.type}`);
    } catch (error) {
      throw new ImageLoadFailedError(service.name, this.provider.type, error);
    }
  }

  loadAllImages(): void {
    for (const service of this.config.services) {
      if (service.build) {
        this.loadImage(service);
      }
    }
  }

  helmUpgrade(): void {
    printInfo('Running helm upgrade...');

    const { chart, release, valuesFiles, secretsTemplate } = this.config.helm;
    const chartPath = join(this.config.repoRoot, chart);

    // Build helm command
    const valuesArgs = valuesFiles
      .map(f => `-f ${join(this.config.repoRoot, f)}`)
      .join(' ');

    const secretsArg = secretsTemplate
      ? `-f ${join(this.config.repoRoot, secretsTemplate)}`
      : '';

    const waitArgs = this.config.helm.wait !== false
      ? ['--wait', '--timeout 5m']
      : [];

    const helmCmd = [
      'helm upgrade',
      '--install',
      release,
      chartPath,
      `-n ${this.state.namespace}`,
      '--create-namespace',
      valuesArgs,
      secretsArg,
      ...waitArgs,
    ]
      .filter(Boolean)
      .join(' ');

    try {
      execSync(helmCmd, { stdio: 'inherit' });
      printSuccess('Helm upgrade complete');
    } catch (error) {
      throw new DeploymentFailedError(`Helm upgrade failed: ${error}`);
    }
  }

  async buildAndDeploy(options?: BuildAndDeployOptions): Promise<void> {
    if (options?.devServices?.length) {
      // Dev mode: pull non-dev from registry, build only dev services locally
      const puller = new RegistryPuller(this.config, this.provider);
      puller.pullAllNonDev(options.devServices, { forcePull: options.forcePull });

      for (const service of this.config.services) {
        if (service.build && options.devServices.includes(service.name)) {
          this.buildService(service);
          this.loadImage(service);
        }
      }
    } else {
      this.buildAllServices();
      this.loadAllImages();
    }
    this.helmUpgrade();
  }
}
