import { execSync } from 'child_process';
import { existsSync } from 'fs';
import type { GroveConfig } from '../config.js';
import { printInfo, printSuccess, printWarning } from '../shared/output.js';

export function pruneOrphanedResources(config: GroveConfig): void {
  const namespacePrefix = config.project.name;

  printInfo('Checking for orphaned resources...');

  // Get all namespaces with our prefix
  let namespaces: string[] = [];
  try {
    const output = execSync(
      `kubectl get namespaces -o jsonpath='{.items[*].metadata.name}'`,
      { encoding: 'utf-8' }
    );
    namespaces = output.split(' ').filter(ns => ns.startsWith(namespacePrefix));
  } catch (error) {
    printWarning('Failed to list namespaces');
    return;
  }

  if (namespaces.length === 0) {
    printSuccess('No namespaces found with prefix ' + namespacePrefix);
    return;
  }

  // For each namespace, check if it has a corresponding state file
  const stateDir = `${config.repoRoot}/.grove`;
  let orphanCount = 0;

  for (const ns of namespaces) {
    // Extract worktree ID from namespace (format: {project}-{worktreeId})
    const worktreeId = ns.substring(namespacePrefix.length + 1);
    const stateFile = `${stateDir}/${worktreeId}.json`;

    try {
      if (!existsSync(stateFile)) {
        printWarning(`Orphaned namespace: ${ns} (no state file)`);

        // Delete the namespace
        try {
          execSync(`kubectl delete namespace ${ns}`, { stdio: 'inherit' });
          printSuccess(`Deleted orphaned namespace: ${ns}`);
          orphanCount++;
        } catch (error) {
          printWarning(`Failed to delete namespace ${ns}`);
        }
      }
    } catch (error) {
      // Continue with next namespace
    }
  }

  if (orphanCount === 0) {
    printSuccess('No orphaned resources found');
  } else {
    printSuccess(`Cleaned up ${orphanCount} orphaned namespace(s)`);
  }
}
