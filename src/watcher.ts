import { watch, type FSWatcher } from 'chokidar';
import { join } from 'path';
import { readFileSync, unlinkSync } from 'fs';
import type { GroveConfig, Service } from './config.js';
import type { EnvironmentState } from './state.js';
import { BuildOrchestrator } from './processes/BuildOrchestrator.js';
import { printInfo, printSuccess } from './shared/output.js';

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private config: GroveConfig,
    private state: EnvironmentState
  ) {}

  start(): void {
    const watchPaths: Array<{ service: Service; paths: string[] }> = [];

    // Collect all watch paths from services
    for (const service of this.config.services) {
      if (service.build?.watchPaths && service.build.watchPaths.length > 0) {
        watchPaths.push({
          service,
          paths: service.build.watchPaths.map(p => join(this.config.repoRoot, p)),
        });
      }
    }

    // Flatten all paths for chokidar
    const allPaths = watchPaths.flatMap(wp => wp.paths);

    // Add reload request file to watch paths
    const reloadRequestPath = join(this.config.repoRoot, '.reload-request');
    allPaths.push(reloadRequestPath);

    if (allPaths.length === 1 && watchPaths.length === 0) {
      printInfo('No service watch paths configured, watching for reload requests only');
    } else {
      printInfo(`Watching ${allPaths.length - 1} service path(s) for changes...`);
    }

    this.watcher = watch(allPaths, {
      ignored: (path: string) => /(^|[\/\\])\./.test(path) && !path.endsWith('.reload-request'),
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', (path: string) => {
      // Handle reload requests from `grove reload`
      if (path === reloadRequestPath) {
        this.handleReloadRequest(path);
        return;
      }

      // Find which service this path belongs to
      for (const { service, paths } of watchPaths) {
        const matchesPath = paths.some(wp => path.startsWith(wp));

        if (matchesPath) {
          this.handleChange(service, path);
          break;
        }
      }
    });

    this.watcher.on('add', (path: string) => {
      if (path === reloadRequestPath) {
        this.handleReloadRequest(path);
      }
    });

    printSuccess('File watcher started');
  }

  private handleChange(service: Service, path: string): void {
    printInfo(`File changed: ${path}`);
    this.scheduleRebuild(service);
  }

  private scheduleRebuild(service: Service): void {
    const key = service.name;
    const existingTimer = this.debounceTimers.get(key);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.rebuild(service);
      this.debounceTimers.delete(key);
    }, 500);

    this.debounceTimers.set(key, timer);
  }

  private async rebuild(service: Service): Promise<void> {
    printInfo(`Rebuilding ${service.name}...`);

    try {
      const orchestrator = new BuildOrchestrator(this.config, this.state);
      orchestrator.buildService(service);
      orchestrator.loadImageToKind(service);
      orchestrator.helmUpgrade();

      printSuccess(`${service.name} rebuilt and deployed`);
    } catch (error) {
      console.error(`Failed to rebuild ${service.name}:`, error);
    }
  }

  private handleReloadRequest(path: string): void {
    try {
      const serviceName = readFileSync(path, 'utf-8').trim();
      const service = this.config.services.find(s => s.name === serviceName);
      if (service) {
        printInfo(`Reload requested for ${serviceName}`);
        this.scheduleRebuild(service);
      }
      unlinkSync(path);
    } catch {
      // File might have been deleted already
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      printSuccess('File watcher stopped');
    }

    // Clear all pending timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
