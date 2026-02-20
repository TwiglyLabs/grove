import type { RepoId } from '../shared/identity.js';
import { status } from '../api/environment.js';
import { printWarning, printDashboard } from '../shared/output.js';
import type { DashboardData as InternalDashboardData } from '../shared/output.js';

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function statusCommand(repoId: RepoId): Promise<void> {
  const data = await status(repoId);

  if (!data) {
    printWarning('No state file found - environment is not running');
    return;
  }

  // Map API DashboardData to internal printDashboard format
  const processes = [
    ...data.services.map(s => ({
      name: s.name,
      pid: s.pid ?? 0,
      startedAt: '',
      running: s.status === 'running',
    })),
    ...data.frontends.map(f => ({
      name: f.name,
      pid: f.pid ?? 0,
      startedAt: '',
      running: f.status === 'running',
    })),
  ].filter(p => p.pid > 0);

  const portForwards = data.services
    .filter(s => s.port)
    .map(s => ({
      service: s.name,
      port: s.port!,
      healthy: s.status === 'running',
    }));

  const urls: Record<string, string> = {};
  for (const s of data.services) {
    if (s.url) urls[s.name] = s.url;
  }
  for (const f of data.frontends) {
    if (f.url) urls[f.name] = f.url;
  }

  const ports: Record<string, number> = {};
  for (const s of data.services) {
    if (s.port) ports[s.name] = s.port;
  }

  const dashboardData: InternalDashboardData = {
    state: data.state === 'down' ? 'error' : data.state === 'unknown' ? 'healthy' : data.state as 'healthy' | 'degraded' | 'error',
    namespace: data.namespace,
    branch: '',
    worktreeId: '',
    lastEnsure: '',
    health: {
      namespace: data.namespace,
      healthy: data.state === 'healthy',
      pods: [],
    },
    portForwards,
    processes,
    urls,
    ports,
  };

  printDashboard(dashboardData);
}
