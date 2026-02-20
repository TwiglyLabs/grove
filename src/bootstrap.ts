import { execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { join } from 'path';
import type { GroveConfig, BootstrapStep } from './config.js';
import { printInfo, printSuccess, printWarning } from './shared/output.js';

function checkCondition(check: BootstrapStep['check'], repoRoot: string): boolean {
  switch (check.type) {
    case 'fileExists': {
      const filePath = join(repoRoot, check.path);
      return existsSync(filePath);
    }
    case 'dirExists': {
      const dirPath = join(repoRoot, check.path);
      return existsSync(dirPath);
    }
    case 'commandSucceeds': {
      try {
        execSync(check.command, { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function applyFix(fix: BootstrapStep['fix'], repoRoot: string): void {
  switch (fix.type) {
    case 'copyFrom': {
      const sourcePath = join(repoRoot, fix.source);
      const destPath = join(repoRoot, fix.dest);
      copyFileSync(sourcePath, destPath);
      printSuccess(`Copied ${fix.source} to ${fix.dest}`);
      break;
    }
    case 'run': {
      execSync(fix.command, { stdio: 'inherit', cwd: repoRoot });
      printSuccess(`Executed: ${fix.command}`);
      break;
    }
  }
}

export async function runBootstrapChecks(config: GroveConfig): Promise<void> {
  if (!config.bootstrap || config.bootstrap.length === 0) {
    return;
  }

  printInfo('Running bootstrap checks...');

  for (const step of config.bootstrap) {
    const passed = checkCondition(step.check, config.repoRoot);

    if (!passed) {
      printWarning(`Bootstrap check failed: ${step.name}`);
      printInfo('Applying fix...');
      applyFix(step.fix, config.repoRoot);
    } else {
      printSuccess(`Bootstrap check passed: ${step.name}`);
    }
  }
}
