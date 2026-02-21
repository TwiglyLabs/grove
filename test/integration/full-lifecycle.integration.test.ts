/**
 * Full parallel lifecycle integration test.
 *
 * Exercises the complete provisioning flow against a real cluster:
 * 1. Register temp repos
 * 2. Create workspaces in parallel
 * 3. Run up() on each — allocates ports, namespaces, deploys
 * 4. Call describe() on each — verify no port/namespace overlap
 * 5. Verify services are reachable at their URLs
 * 6. Destroy all environments
 * 7. Run prune(), verify clean state
 *
 * Requirements: docker, kubectl, helm, kind or k3s, reachable cluster.
 * Run with: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';

import { canRunIntegrationTests, formatMissingPrerequisites } from './helpers/cluster.js';
import { scaffoldRepos, cleanupAll, type ScaffoldedRepo } from './helpers/scaffold.js';
import {
  assertUniqueNamespaces,
  assertNonOverlappingPorts,
  assertValidDescriptor,
  assertCleanState,
} from './helpers/assertions.js';

import * as repo from '../../src/repo/api.js';
import * as workspace from '../../src/workspace/api.js';
import * as environment from '../../src/environment/api.js';
import type { RepoId, WorkspaceId } from '../../src/shared/identity.js';
import type { EnvironmentDescriptor } from '../../src/workspace/types.js';
import type { EnvironmentState } from '../../src/environment/types.js';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'minimal.grove.yaml');
const WORKSPACE_COUNT = 3;

// Check prerequisites once at module load — avoids redundant shell execs
const prerequisitesMet = canRunIntegrationTests();
if (!prerequisitesMet) {
  console.warn(`Skipping integration tests: ${formatMissingPrerequisites()}`);
}

/**
 * Attempt an HTTP health check against a URL.
 * Returns true if a 2xx response is received within the timeout.
 */
async function httpHealthCheck(
  url: string,
  timeoutMs: number = 10_000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

describe.skipIf(!prerequisitesMet).sequential('Full parallel lifecycle', () => {
  let repos: ScaffoldedRepo[] = [];
  let repoIds: RepoId[] = [];
  let workspaceIds: WorkspaceId[] = [];
  let descriptors: EnvironmentDescriptor[] = [];
  let upResults: Array<{ state: EnvironmentState; urls: Record<string, string>; ports: Record<string, number> }> = [];

  // --- Setup: scaffold repos and register them ---

  beforeAll(async () => {
    repos = scaffoldRepos(FIXTURE_PATH, WORKSPACE_COUNT);

    // Register all repos in parallel
    const entries = await Promise.all(
      repos.map(r => repo.add(r.path)),
    );
    repoIds = entries.map(e => e.id);
  });

  // --- Teardown: destroy environments, close workspaces, unregister, cleanup ---

  afterAll(async () => {
    // Destroy all environments (best-effort)
    for (const repoId of repoIds) {
      try {
        await environment.destroy(repoId);
      } catch {
        // Best-effort
      }
    }

    // Close all workspaces (best-effort)
    for (const wsId of workspaceIds) {
      try {
        await workspace.close(wsId, 'discard');
      } catch {
        // Best-effort
      }
    }

    // Unregister repos (best-effort)
    for (const repoId of repoIds) {
      try {
        await repo.remove(repoId);
      } catch {
        // Best-effort
      }
    }

    // Remove temp directories
    cleanupAll(repos);
  });

  // --- Test: Create workspaces in parallel ---

  it('should create workspaces in parallel without conflicts', async () => {
    const createResults = await Promise.all(
      repoIds.map((repoId, i) =>
        workspace.create(`integration-test-${i}`, { from: repoId }),
      ),
    );

    workspaceIds = createResults.map(r => r.id);

    // All should have unique IDs
    const uniqueIds = new Set(workspaceIds);
    expect(uniqueIds.size).toBe(WORKSPACE_COUNT);

    // All should have unique branches
    const branches = new Set(createResults.map(r => r.branch));
    expect(branches.size).toBe(WORKSPACE_COUNT);

    // All should report repos
    for (const result of createResults) {
      expect(result.repos.length).toBeGreaterThan(0);
      expect(result.root).toBeTruthy();
    }
  });

  // --- Test: Bring up environments in parallel ---

  it('should bring up environments with unique ports and namespaces', async () => {
    upResults = await Promise.all(
      repoIds.map(repoId => environment.up(repoId)),
    );

    // Each should have allocated ports and URLs
    for (const result of upResults) {
      expect(Object.keys(result.ports).length).toBeGreaterThan(0);
      expect(Object.keys(result.urls).length).toBeGreaterThan(0);
      expect(result.state.namespace).toBeTruthy();
    }

    // Namespaces should be unique across all environments
    const namespaces = upResults.map(r => r.state.namespace);
    const uniqueNamespaces = new Set(namespaces);
    expect(uniqueNamespaces.size).toBe(WORKSPACE_COUNT);

    // Ports should not overlap across environments
    const allPorts = upResults.flatMap(r => Object.values(r.ports));
    const uniquePorts = new Set(allPorts);
    expect(uniquePorts.size).toBe(allPorts.length);
  });

  // --- Test: Describe environments and verify descriptors ---

  it('should produce valid descriptors with no port/namespace overlap', async () => {
    descriptors = workspaceIds.map(wsId => workspace.describe(wsId));

    // Each descriptor should be structurally valid
    for (const descriptor of descriptors) {
      assertValidDescriptor(descriptor);
    }

    // No port overlap across descriptors
    assertNonOverlappingPorts(descriptors);

    // No namespace overlap (use upResults for actual namespace values)
    assertUniqueNamespaces(
      descriptors.map((desc, i) => ({
        descriptor: desc,
        namespace: upResults[i].state.namespace,
      })),
    );
  });

  // --- Test: Services are reachable at their URLs ---

  it('should have reachable services at assigned URLs', async () => {
    for (const descriptor of descriptors) {
      for (const service of descriptor.services) {
        if (!service.url) continue;

        const healthUrl = service.url.endsWith('/')
          ? `${service.url}health`
          : `${service.url}/health`;

        const reachable = await httpHealthCheck(healthUrl);
        expect(reachable, `Service ${service.name} at ${healthUrl} should be reachable`).toBe(true);
      }
    }
  });

  // --- Test: Destroy all environments ---

  it('should destroy all environments cleanly', async () => {
    const destroyResults = await Promise.all(
      repoIds.map(repoId => environment.destroy(repoId)),
    );

    for (const result of destroyResults) {
      expect(result.namespaceDeleted).toBe(true);
      expect(result.stateRemoved).toBe(true);
    }
  });

  // --- Test: Prune verifies clean state ---

  it('should report clean state after destroy + prune', async () => {
    // Prune from the first repo — prune scans for all orphans globally
    const pruneResult = await environment.prune(repoIds[0]);

    assertCleanState(pruneResult);
  });
});
