import { execSync } from 'child_process';
import { join } from 'path';
import type { GroveConfig, Service } from '../../config.js';
import type { ClusterProvider, EnvironmentState } from '../types.js';
import { printInfo, printSuccess } from '../../shared/output.js';

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

    const { image, dockerfile } = service.build;
    const dockerfilePath = join(this.config.repoRoot, dockerfile);

    // docker build -t <image> -f <dockerfile> <repoRoot>
    const buildCmd = `docker build -t ${image} -f ${dockerfilePath} ${this.config.repoRoot}`;

    try {
      execSync(buildCmd, { stdio: 'inherit' });
      printSuccess(`Built ${service.name}`);
    } catch (error) {
      throw new Error(`Failed to build ${service.name}: ${error}`);
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
      throw new Error(`Failed to load ${service.name} to ${this.provider.type}: ${error}`);
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

    const helmCmd = [
      'helm upgrade',
      '--install',
      release,
      chartPath,
      `-n ${this.state.namespace}`,
      '--create-namespace',
      valuesArgs,
      secretsArg,
      '--wait',
      '--timeout 5m',
    ]
      .filter(Boolean)
      .join(' ');

    try {
      execSync(helmCmd, { stdio: 'inherit' });
      printSuccess('Helm upgrade complete');
    } catch (error) {
      throw new Error(`Helm upgrade failed: ${error}`);
    }
  }

  async buildAndDeploy(): Promise<void> {
    this.buildAllServices();
    this.loadAllImages();
    this.helmUpgrade();
  }
}
