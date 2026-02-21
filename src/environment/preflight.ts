import { execSync } from 'node:child_process';
import { createServer } from 'node:net';
import type { GroveConfig } from '../config.js';
import type { PreflightCheck, PreflightResult } from './types.js';
import { PreflightFailedError } from '../shared/errors.js';
import { printSuccess, printWarning } from '../shared/output.js';
import { readState } from './state.js';

function checkCommand(command: string, friendlyName: string): PreflightCheck {
  try {
    execSync(command, { stdio: 'pipe' });
    return { name: friendlyName, passed: true };
  } catch {
    return { name: friendlyName, passed: false, message: `${friendlyName} not found or not responding` };
  }
}

function checkPort(port: number, name: string): Promise<PreflightCheck> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve({ name: `port-${name}`, passed: false, message: `Port ${port} (${name}) is already in use` });
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        resolve({ name: `port-${name}`, passed: true });
      });
    });
  });
}

export async function runPreflightChecks(config: GroveConfig): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];

  // Check container runtime (docker)
  const dockerCheck = checkCommand('docker info', 'docker');
  if (!dockerCheck.passed) {
    dockerCheck.message = 'Docker/container runtime not available. Is Colima or Docker Desktop running?';
  }
  checks.push(dockerCheck);

  // Check kubectl
  checks.push(checkCommand('kubectl version --client', 'kubectl'));

  // Check helm
  checks.push(checkCommand('helm version --short', 'helm'));

  // Check cluster provider
  if (config.project.clusterType === 'kind') {
    checks.push(checkCommand('kind version', 'kind'));
  } else {
    checks.push(checkCommand('k3d version', 'k3d'));
  }

  // Check port availability if state file exists
  const state = readState(config);
  if (state !== null) {
    const portChecks = await Promise.all(
      Object.entries(state.ports).map(([name, port]) => checkPort(port, name)),
    );
    checks.push(...portChecks);
  }

  // Print results
  for (const check of checks) {
    if (check.passed) {
      printSuccess(`${check.name}: ok`);
    } else {
      printWarning(`${check.name}: ${check.message ?? 'failed'}`);
    }
  }

  const failedChecks = checks.filter((c) => !c.passed);
  const passed = failedChecks.length === 0;

  if (!passed) {
    throw new PreflightFailedError(
      failedChecks.map((c) => ({ name: c.name, message: c.message })),
    );
  }

  return { passed, checks };
}
