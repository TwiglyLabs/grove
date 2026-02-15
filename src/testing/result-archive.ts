import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { GroveConfig } from '../config.js';

/**
 * Archive test results to history directory with timestamp.
 */
export function archiveResults(
  platform: string,
  suite: string,
  outputDir: string,
  config: GroveConfig
): void {
  const historyDir = path.join(config.repoRoot, config.testing?.historyDir ?? '.grove/test-history');
  const historyLimit = config.testing?.historyLimit ?? 10;

  fs.mkdirSync(historyDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const archiveName = `${timestamp}-${platform}${suite && suite !== 'default' ? '-' + suite : ''}`;
  const archiveDir = path.join(historyDir, archiveName);

  fs.mkdirSync(archiveDir, { recursive: true });

  // Copy output directory contents to archive
  try {
    execSync(`cp -r "${outputDir}"/* "${archiveDir}"/`, { stdio: 'ignore' });
  } catch {
    // Ignore copy errors
  }

  // Clean up old history (keep last N)
  pruneHistory(historyDir, historyLimit);
}

/**
 * Prune history directory to keep only the most recent entries.
 */
export function pruneHistory(historyDir: string, limit: number): void {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(historyDir)
      .filter(e => e.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/))
      .sort();
  } catch {
    return;
  }

  if (entries.length > limit) {
    const toDelete = entries.slice(0, entries.length - limit);
    for (const entry of toDelete) {
      try {
        const entryPath = path.join(historyDir, entry);
        if (fs.existsSync(entryPath)) {
          fs.rmSync(entryPath, { recursive: true, force: true });
        }
      } catch {
        // Ignore deletion errors
      }
    }
  }
}
