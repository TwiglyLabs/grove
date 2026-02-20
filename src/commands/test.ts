import type { RepoId } from '../shared/identity.js';
import type { TestPlatform } from '../types.js';
import { runTests } from '../api/testing.js';
import { load as loadConfig } from '../shared/config.js';
import { printError, printTestResult, printTestFailures } from '../shared/output.js';

function parseTestArgs(args: string[]): { platform: TestPlatform | undefined; options: Record<string, unknown>; json?: boolean } {
  const platform = args[0] as TestPlatform | undefined;
  const options: Record<string, unknown> = {};
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--suite' && args[i + 1]) {
      options.suite = args[++i];
    } else if (arg === '--flow' && args[i + 1]) {
      if (!options.flow) options.flow = [];
      (options.flow as string[]).push(args[++i]);
    } else if (arg === '--file' && args[i + 1]) {
      options.file = args[++i];
    } else if (arg === '--grep' && args[i + 1]) {
      options.grep = args[++i];
    } else if (arg === '--use-dev') {
      options.useDev = true;
    } else if (arg === '--ai') {
      options.ai = true;
    } else if (arg === '--exclude-ai') {
      options.excludeAi = true;
    } else if (arg === '--no-ensure') {
      options.noEnsure = true;
    } else if (arg === '--timeout' && args[i + 1]) {
      options.timeout = parseInt(args[++i], 10);
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--json') {
      json = true;
    }
  }

  return { platform, options, json };
}

export async function testCommand(repoId: RepoId, args: string[]): Promise<void> {
  const { platform, options, json } = parseTestArgs(args);

  if (!platform || !['mobile', 'webapp', 'api'].includes(platform)) {
    printError('Usage: grove test <mobile|webapp|api> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --suite <name>     Named test suite (mobile)');
    console.log('  --flow <path>      Flow path, repeatable (mobile)');
    console.log('  --file <path>      Test file filter (webapp, api)');
    console.log('  --grep <pattern>   Test name filter (webapp, api)');
    console.log('  --use-dev          Use dev environment for API URL (api)');
    console.log('  --ai               Include AI tests (api)');
    console.log('  --exclude-ai       Exclude AI tests (api)');
    console.log('  --no-ensure        Skip auto-ensure');
    console.log('  --timeout <ms>     Timeout in milliseconds');
    console.log('  --verbose          Verbose output');
    console.log('  --json             Output raw JSON (for CI/scripting)');
    process.exit(1);
  }

  // Validate platform exists in config
  const config = await loadConfig(repoId);
  if (platform === 'mobile' && !config.testing?.mobile) {
    printError('No mobile testing configuration in .grove.yaml');
    process.exit(1);
  }
  if (platform === 'webapp' && !config.testing?.webapp) {
    printError('No webapp testing configuration in .grove.yaml');
    process.exit(1);
  }
  if (platform === 'api' && !config.testing?.api) {
    printError('No api testing configuration in .grove.yaml');
    process.exit(1);
  }

  const result = await runTests(repoId, {
    platform,
    suite: options.suite as string | undefined,
    flow: options.flow as string[] | undefined,
    file: options.file as string | undefined,
    grep: options.grep as string | undefined,
    useDev: options.useDev as boolean | undefined,
    ai: options.ai as boolean | undefined,
    excludeAi: options.excludeAi as boolean | undefined,
    noEnsure: options.noEnsure as boolean | undefined,
    timeout: options.timeout as number | undefined,
    verbose: options.verbose as boolean | undefined,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTestResult(result);
    if (result.failures && result.failures.length > 0) {
      printTestFailures(result.failures);
    }
  }

  // Exit codes: 0=pass, 1=fail, 2=error, 3=timeout
  if (result.run.result === 'pass') {
    process.exit(0);
  } else if (result.run.result === 'fail') {
    process.exit(1);
  } else if (result.run.result === 'error') {
    process.exit(2);
  } else if (result.run.result === 'timeout') {
    process.exit(3);
  }
}
