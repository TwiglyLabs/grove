/**
 * Temporary repo scaffolding for integration tests.
 *
 * Creates a temporary git repo with a .grove.yaml config,
 * registers it in the grove repo registry, and cleans up after.
 */

import { mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

export interface ScaffoldedRepo {
  /** Absolute path to the temp repo root */
  path: string;
  /** Unique name for this scaffold (used in branch names) */
  name: string;
  /** Cleanup function — removes the temp directory */
  cleanup: () => void;
}

/**
 * Create a temporary git repo seeded with a .grove.yaml fixture.
 *
 * @param fixturePath - Absolute path to a .grove.yaml fixture file
 * @param suffix - Optional suffix for uniqueness (e.g., "ws-1")
 */
export function scaffoldRepo(fixturePath: string, suffix?: string): ScaffoldedRepo {
  const id = randomBytes(4).toString('hex');
  const name = `grove-integration-${suffix ?? id}`;
  const repoDir = join(tmpdir(), name);

  // Create directory structure
  mkdirSync(repoDir, { recursive: true });

  // Copy fixture as .grove.yaml
  cpSync(fixturePath, join(repoDir, '.grove.yaml'));

  // Create .grove state directory
  mkdirSync(join(repoDir, '.grove', 'workspaces'), { recursive: true });

  // Initialize git repo (required for workspace operations)
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git checkout -b main', { cwd: repoDir, stdio: 'pipe' });

  // Create a minimal commit so branches work
  writeFileSync(join(repoDir, 'README.md'), `# ${name}\n`);
  execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

  return {
    path: repoDir,
    name,
    cleanup: () => {
      try {
        rmSync(repoDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    },
  };
}

/**
 * Create multiple scaffolded repos, each with the same fixture.
 */
export function scaffoldRepos(
  fixturePath: string,
  count: number,
): ScaffoldedRepo[] {
  return Array.from({ length: count }, (_, i) =>
    scaffoldRepo(fixturePath, `ws-${i}`),
  );
}

/**
 * Cleanup all scaffolded repos.
 */
export function cleanupAll(repos: ScaffoldedRepo[]): void {
  for (const repo of repos) {
    repo.cleanup();
  }
}
