import { execSync } from 'node:child_process';
import { deleteNamespace } from './cluster.js';

export async function cleanupSmokeEnvironment(namespace: string): Promise<void> {
  // Uninstall any helm releases in the namespace
  try {
    const output = execSync(`helm list -n ${namespace} -q`, { stdio: 'pipe' }).toString().trim();
    if (output) {
      for (const release of output.split('\n')) {
        try {
          execSync(`helm uninstall ${release} -n ${namespace}`, { stdio: 'pipe', timeout: 30_000 });
        } catch {
          // Best effort
        }
      }
    }
  } catch {
    // No releases or namespace doesn't exist
  }

  // Delete the namespace
  deleteNamespace(namespace);
}
