/**
 * Custom assertion helpers for integration tests.
 *
 * Validates uniqueness constraints, environment descriptor integrity,
 * and clean-state invariants.
 */

import type { EnvironmentDescriptor } from '../../../src/workspace/types.js';
import type { PruneResult } from '../../../src/environment/types.js';

/**
 * Assert that all descriptors have unique namespaces — no two workspaces
 * should share a k8s namespace.
 */
export function assertUniqueNamespaces(
  descriptors: Array<{ descriptor: EnvironmentDescriptor; namespace: string }>,
): void {
  const namespaces = descriptors.map(d => d.namespace);
  const unique = new Set(namespaces);

  if (unique.size !== namespaces.length) {
    const counts = new Map<string, number>();
    for (const ns of namespaces) {
      counts.set(ns, (counts.get(ns) ?? 0) + 1);
    }
    const dupes = [...counts.entries()]
      .filter(([, c]) => c > 1)
      .map(([ns]) => ns);

    throw new Error(
      `Namespace collision detected: ${dupes.join(', ')}. ` +
      `Expected ${namespaces.length} unique namespaces, got ${unique.size}.`,
    );
  }
}

/**
 * Assert that no two descriptors share any port assignments.
 */
export function assertNonOverlappingPorts(
  descriptors: EnvironmentDescriptor[],
): void {
  const allPorts: Array<{ workspace: string; service: string; port: number }> = [];

  for (const desc of descriptors) {
    for (const svc of desc.services) {
      if (svc.port > 0) {
        allPorts.push({
          workspace: desc.workspace.id,
          service: svc.name,
          port: svc.port,
        });
      }
    }
  }

  const portSet = new Set<number>();
  const conflicts: string[] = [];

  for (const entry of allPorts) {
    if (portSet.has(entry.port)) {
      conflicts.push(
        `Port ${entry.port} used by ${entry.workspace}/${entry.service} conflicts`,
      );
    }
    portSet.add(entry.port);
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Port overlap detected:\n${conflicts.join('\n')}`,
    );
  }
}

/**
 * Assert that a descriptor is structurally valid — has workspace info,
 * services with URLs/ports, etc.
 */
export function assertValidDescriptor(
  descriptor: EnvironmentDescriptor,
): void {
  if (!descriptor.workspace.id) {
    throw new Error('Descriptor missing workspace.id');
  }
  if (!descriptor.workspace.branch) {
    throw new Error('Descriptor missing workspace.branch');
  }
  if (descriptor.workspace.repos.length === 0) {
    throw new Error('Descriptor has no repos');
  }

  for (const svc of descriptor.services) {
    if (!svc.name) {
      throw new Error('Service descriptor missing name');
    }
    if (svc.port === 0) {
      throw new Error(`Service ${svc.name} has port 0 (unallocated)`);
    }
    if (!svc.url) {
      throw new Error(`Service ${svc.name} has empty URL`);
    }
  }
}

/**
 * Assert that a prune result shows zero orphans across all categories.
 */
export function assertCleanState(result: PruneResult): void {
  const issues: string[] = [];

  if (result.stoppedProcesses.length > 0) {
    issues.push(
      `${result.stoppedProcesses.length} stopped processes found`,
    );
  }
  if (result.danglingPorts.length > 0) {
    issues.push(
      `${result.danglingPorts.length} dangling ports found`,
    );
  }
  if (result.staleStateFiles.length > 0) {
    issues.push(
      `${result.staleStateFiles.length} stale state files found`,
    );
  }
  if (result.orphanedWorktrees.length > 0) {
    issues.push(
      `${result.orphanedWorktrees.length} orphaned worktrees found`,
    );
  }
  if (result.orphanedNamespaces.length > 0) {
    issues.push(
      `${result.orphanedNamespaces.length} orphaned namespaces found`,
    );
  }

  if (issues.length > 0) {
    throw new Error(
      `State not clean after destroy + prune:\n${issues.join('\n')}`,
    );
  }
}
