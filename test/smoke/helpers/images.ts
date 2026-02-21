import { execSync } from 'node:child_process';
import { join } from 'node:path';

const SERVICES = ['smoke-auth', 'smoke-api', 'smoke-agent', 'smoke-mcp'];

export function buildSmokeImages(fixturesDir: string): void {
  for (const service of SERVICES) {
    const contextDir = join(fixturesDir, 'services', service);
    console.log(`Building ${service}...`);
    execSync(`docker build -t ${service}:latest ${contextDir}`, { stdio: 'inherit' });
  }
}

export function loadSmokeImages(clusterName: string): void {
  for (const service of SERVICES) {
    console.log(`Loading ${service} into cluster ${clusterName}...`);
    execSync(`k3d image import ${service}:latest -c ${clusterName}`, { stdio: 'inherit' });
  }
}
