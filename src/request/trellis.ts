import { readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';

export function toTitle(planName: string): string {
  return planName
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

export function parseTrellisConfig(repoPath: string): string {
  try {
    const content = readFileSync(join(repoPath, '.trellis'), 'utf-8');
    for (const line of content.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (key === 'plans_dir' && value) return value;
    }
  } catch {
    // Missing, unreadable, or malformed — fall back to default
  }
  return 'plans';
}

export function detectSourceRepoName(
  registry: { repos: Array<{ name: string; path: string }> },
): string | null {
  try {
    const gitCommonDir = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const repoRoot = dirname(resolve(gitCommonDir));
    const match = registry.repos.find(r => resolve(r.path) === repoRoot);
    return match ? match.name : null;
  } catch {
    return null;
  }
}
