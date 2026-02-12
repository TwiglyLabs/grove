import { watch } from 'chokidar';
import { join } from 'path';
import type { GroveConfig, Service } from './config.js';
import type { EnvironmentState } from './state.js';
import { BuildOrchestrator } from './processes/BuildOrchestrator.js';
import { printInfo, printSuccess } from './output.js';

export class FileWatcher {
  private watcher: any = null;
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

    if (watchPaths.length === 0) {
      printInfo('No watch paths configured');
      return;
    }

    // Flatten all paths for chokidar
    const allPaths = watchPaths.flatMap(wp => wp.paths);

    printInfo(`Watching ${allPaths.length} path(s) for changes...`);

    this.watcher = watch(allPaths, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('change', (path: string) => {
      // Find which service this path belongs to
      for (const { service, paths } of watchPaths) {
        const matchesPath = paths.some(wp => path.startsWith(wp));

        if (matchesPath) {
          this.handleChange(service, path);
          break;
        }
      }
    });

    printSuccess('File watcher started');
  }

  private handleChange(service: Service, path: string): void {
    printInfo(`File changed: ${path}`);

    // Debounce rebuilds (wait 500ms after last change)
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
