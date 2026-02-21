import { execSync } from 'child_process';
import { join } from 'path';
import type { GroveConfig } from '../config.js';
import type { EnvironmentState } from './types.js';
import { ensureCluster, ensureNamespace } from './cluster.js';
import { loadOrCreateState, writeState } from './state.js';
import { runBootstrapChecks } from './bootstrap.js';
import { BuildOrchestrator } from './processes/BuildOrchestrator.js';
import { createClusterProvider } from './providers/index.js';
import { PortForwardProcess } from './processes/PortForwardProcess.js';
import { GenericDevServer } from './frontends/GenericDevServer.js';
import { waitForHealth } from './health.js';
import { printInfo, printSuccess, printError, printSection } from '../shared/output.js';
import { Timer } from './timing.js';

async function waitForDeployments(namespace: string, timeoutSeconds: number = 300): Promise<void> {
  printInfo('Waiting for deployments to be ready...');

  try {
    execSync(
      `kubectl wait --for=condition=available --timeout=${timeoutSeconds}s deployment --all -n ${namespace}`,
      { stdio: 'inherit' }
    );
    printSuccess('All deployments ready');
  } catch (error) {
    throw new Error('Deployments failed to become ready');
  }
}

async function startPortForwards(config: GroveConfig, state: EnvironmentState): Promise<void> {
  printSection('Starting port forwards');

  const logsDir = join(config.repoRoot, '.grove', 'logs');

  for (const service of config.services) {
    if (!service.portForward) continue;

    const localPort = state.ports[service.name];
    const remotePort = service.portForward.remotePort;
    const hostIp = service.portForward.hostIp || '127.0.0.1';

    printInfo(`Port forwarding ${service.name}: ${localPort} -> ${remotePort}`);

    const portForward = new PortForwardProcess({
      namespace: state.namespace,
      serviceName: service.name,
      remotePort,
      localPort,
      hostIp,
    });

    const processInfo = await portForward.start(logsDir);
    state.processes[`port-forward-${service.name}`] = processInfo;

    printSuccess(`${service.name} port forward started (PID: ${processInfo.pid})`);
  }
}

async function startFrontends(config: GroveConfig, state: EnvironmentState, options: { frontend?: string; all?: boolean } = {}): Promise<void> {
  if (!config.frontends || config.frontends.length === 0) {
    return;
  }

  // Determine which frontends to start
  let frontendsToStart = config.frontends;
  if (!options.all && !options.frontend) {
    // Default: don't start any frontends (backend-only)
    return;
  }
  if (options.frontend) {
    frontendsToStart = config.frontends.filter(f => f.name === options.frontend);
    if (frontendsToStart.length === 0) {
      printError(`Frontend "${options.frontend}" not found in config`);
      return;
    }
  }

  printSection('Starting frontend dev servers');

  const logsDir = join(config.repoRoot, '.grove', 'logs');

  for (const frontend of frontendsToStart) {
    const port = state.ports[frontend.name];

    printInfo(`Starting ${frontend.name} on port ${port}`);

    const devServer = new GenericDevServer(frontend, port);
    const processInfo = await devServer.start(config.repoRoot, logsDir, state);

    state.processes[frontend.name] = processInfo;

    printSuccess(`${frontend.name} started (PID: ${processInfo.pid})`);
  }
}

async function healthCheckAll(config: GroveConfig, state: EnvironmentState): Promise<void> {
  printSection('Running health checks');

  // Health check services (only those with port-forwards)
  for (const service of config.services) {
    if (!service.health || !service.portForward) {
      continue;
    }

    const port = state.ports[service.name];
    const protocol = service.health.protocol || 'http';
    const path = service.health.path || '/';

    printInfo(`Health checking ${service.name}...`);

    const healthy = await waitForHealth(protocol, '127.0.0.1', port, path, 30, 1000);

    if (healthy) {
      printSuccess(`${service.name} is healthy`);
    } else {
      printError(`${service.name} health check failed`);
    }
  }

  // Health check frontends
  if (config.frontends) {
    for (const frontend of config.frontends) {
      if (!frontend.health) {
        continue;
      }

      const port = state.ports[frontend.name];
      const protocol = frontend.health.protocol || 'http';
      const path = frontend.health.path || '/';

      printInfo(`Health checking ${frontend.name}...`);

      const healthy = await waitForHealth(protocol, '127.0.0.1', port, path, 30, 1000);

      if (healthy) {
        printSuccess(`${frontend.name} is healthy`);
      } else {
        printError(`${frontend.name} health check failed`);
      }
    }
  }
}

export async function ensureEnvironment(config: GroveConfig, options: { frontend?: string; all?: boolean } = {}): Promise<EnvironmentState> {
  const timer = new Timer();

  const provider = createClusterProvider(config.project.clusterType);

  printSection('Ensuring Cluster');
  ensureCluster(provider, config.project.cluster);

  printSection('Bootstrap Checks');
  await runBootstrapChecks(config);

  printSection('Loading State');
  const state = await loadOrCreateState(config);
  printSuccess(`Namespace: ${state.namespace}`);
  printSuccess(`Worktree: ${state.worktreeId}`);

  printSection('Creating Namespace');
  ensureNamespace(state.namespace);

  printSection('Building and Deploying');
  const orchestrator = new BuildOrchestrator(config, state, provider);
  await orchestrator.buildAndDeploy();

  printSection('Waiting for Deployments');
  await waitForDeployments(state.namespace);

  await startPortForwards(config, state);
  await startFrontends(config, state, options);
  await healthCheckAll(config, state);

  printSection('Saving State');
  await writeState(state, config);
  printSuccess('State saved');

  printSuccess(`Environment ready in ${timer.format()}`);

  return state;
}
