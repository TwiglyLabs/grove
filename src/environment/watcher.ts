import { watch, type FSWatcher } from 'chokidar';
import { join } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import type { GroveConfig, Service } from '../config.js';
import type { EnvironmentEvents, EnvironmentState } from './types.js';
import { BuildOrchestrator } from './processes/BuildOrchestrator.js';
import { createClusterProvider } from './providers/index.js';
import { waitForHealth } from './health.js';
import { printInfo, printSuccess, printError } from '../shared/output.js';
import { BuildFailedError, GroveError } from '../shared/errors.js';

export interface WatcherOptions {
  maxRebuildAttempts?: number;
  baseRetryDelayMs?: number;
}

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private rebuilding: Set<string> = new Set();
  private pendingRebuild: Set<string> = new Set();
  private stopped = false;
  private maxRebuildAttempts: number;
  private baseRetryDelayMs: number;

  constructor(
    private config: GroveConfig,
    private state: EnvironmentState,
    private events?: EnvironmentEvents,
    options?: WatcherOptions,
  ) {
    this.maxRebuildAttempts = options?.maxRebuildAttempts ?? 3;
    this.baseRetryDelayMs = options?.baseRetryDelayMs ?? 2000;
  }

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

    // Validate watch paths exist
    for (const { service, paths } of watchPaths) {
      for (const p of paths) {
        if (!existsSync(p)) {
          printError(`Watch path does not exist for ${service.name}: ${p}`);
        }
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

    // If a rebuild is already in flight, mark as pending and skip
    if (this.rebuilding.has(key)) {
      this.pendingRebuild.add(key);
      return;
    }

    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.rebuild(service).catch(err => {
        const groveError = err instanceof GroveError ? err : new BuildFailedError(service.name, err);
        this.events?.onError?.(groveError);
      });
      this.debounceTimers.delete(key);
    }, 500);

    this.debounceTimers.set(key, timer);
  }

  private async rebuild(service: Service): Promise<void> {
    const key = service.name;
    this.rebuilding.add(key);

    try {
      const maxAttempts = this.maxRebuildAttempts;
      const baseDelayMs = this.baseRetryDelayMs;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (this.stopped) return;
        printInfo(`Rebuilding ${service.name}${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ''}...`);
        this.events?.onRebuild?.(service.name, 'start');

        try {
          const provider = createClusterProvider(this.config.project.clusterType);
          const orchestrator = new BuildOrchestrator(this.config, this.state, provider);
          orchestrator.buildService(service);
          orchestrator.loadImage(service);
          orchestrator.helmUpgrade();

          printSuccess(`${service.name} rebuilt and deployed`);
          this.events?.onRebuild?.(service.name, 'complete');

          // Post-rebuild health check
          await this.verifyServiceHealth(service);
          return;
        } catch (error) {
          const groveError = error instanceof GroveError
            ? error
            : new BuildFailedError(service.name, error);

          if (attempt < maxAttempts) {
            const delay = baseDelayMs * Math.pow(2, attempt - 1);
            printError(`Rebuild failed for ${service.name}, retrying in ${delay / 1000}s...`);
            this.events?.onRebuild?.(service.name, 'error', groveError.message);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            printError(`Rebuild failed for ${service.name} after ${maxAttempts} attempts`);
            this.events?.onRebuild?.(service.name, 'error', groveError.message);
            this.events?.onError?.(groveError);
          }
        }
      }
    } finally {
      this.rebuilding.delete(key);

      // Re-trigger if a change came in during the rebuild
      if (this.pendingRebuild.has(key)) {
        this.pendingRebuild.delete(key);
        this.scheduleRebuild(service);
      }
    }
  }

  private async verifyServiceHealth(service: Service): Promise<void> {
    if (this.stopped) return;
    if (!service.health || !service.portForward) return;

    const port = this.state.ports[service.name];
    if (!port) return;

    const protocol = service.health.protocol || 'http';
    const path = service.health.path || '/';

    printInfo(`Verifying ${service.name} health after rebuild...`);
    const healthy = await waitForHealth(protocol, '127.0.0.1', port, path, 10, 2000);

    if (healthy) {
      printSuccess(`${service.name} is healthy after rebuild`);
    } else {
      printError(`${service.name} health check failed after rebuild`);
    }
    this.events?.onHealthCheck?.(service.name, healthy);
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return; // File already deleted — expected race condition
      }
      this.events?.onError?.(
        error instanceof GroveError ? error : new BuildFailedError('reload-request', error),
      );
    }
  }

  stop(): void {
    this.stopped = true;

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
