import { execSync } from 'node:child_process';

export interface HelmInstallOptions {
  release: string;
  chart: string;
  namespace: string;
  values?: string;
  sets?: Record<string, string>;
}

export function helmInstall(opts: HelmInstallOptions): void {
  let cmd = `helm install ${opts.release} ${opts.chart} -n ${opts.namespace} --wait`;
  if (opts.values) {
    cmd += ` -f ${opts.values}`;
  }
  if (opts.sets) {
    for (const [key, value] of Object.entries(opts.sets)) {
      cmd += ` --set ${key}=${value}`;
    }
  }
  console.log(`Helm install: ${opts.release} in ${opts.namespace}`);
  execSync(cmd, { stdio: 'inherit', timeout: 120_000 });
}

export function helmUninstall(release: string, namespace: string): void {
  try {
    execSync(`helm uninstall ${release} -n ${namespace} --wait`, { stdio: 'pipe', timeout: 60_000 });
  } catch {
    // Best effort
  }
}

export function waitForDeployments(namespace: string, timeoutSec: number = 120): void {
  execSync(
    `kubectl wait --for=condition=available --timeout=${timeoutSec}s deployment --all -n ${namespace}`,
    { stdio: 'inherit', timeout: (timeoutSec + 10) * 1000 },
  );
}
