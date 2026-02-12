import type { GroveConfig } from '../config.js';
import { readState } from '../state.js';
import { printWarning, printDashboard } from '../output.js';
import type { DashboardData } from '../output.js';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function statusCommand(config: GroveConfig): Promise<void> {
  const state = readState(config);

  if (!state) {
    printWarning('No state file found - environment is not running');
    return;
  }

  // Build dashboard data from state
  const processes = Object.entries(state.processes).map(([name, info]) => ({
    name,
    pid: info.pid,
    startedAt: info.startedAt,
    running: isProcessRunning(info.pid),
  }));

  const portForwards = Object.entries(state.ports)
    .filter(([name]) => config.services.some(s => s.name === name && s.portForward))
    .map(([name, port]) => ({
      service: name,
      port,
      healthy: true, // Port forwards are assumed healthy if state exists
    }));

  // Determine overall state
  const allRunning = processes.every(p => p.running);
  const overallState: DashboardData['state'] = processes.length === 0
    ? 'healthy'
    : allRunning
      ? 'healthy'
      : processes.some(p => p.running)
        ? 'degraded'
        : 'error';

  const dashboardData: DashboardData = {
    state: overallState,
    namespace: state.namespace,
    branch: state.branch,
    worktreeId: state.worktreeId,
    lastEnsure: state.lastEnsure,
    health: {
      namespace: state.namespace,
      healthy: overallState === 'healthy',
      pods: [], // Would require kubectl call — omit for now
    },
    portForwards,
    processes,
    urls: state.urls,
    ports: state.ports,
  };

  printDashboard(dashboardData);
}
