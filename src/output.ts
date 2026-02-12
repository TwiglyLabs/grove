import chalk from 'chalk';

export function printBanner(projectName: string): void {
  console.log();
  console.log(chalk.cyan.bold(`╔═══════════════════════════════════════╗`));
  console.log(chalk.cyan.bold(`║  Grove - ${projectName.padEnd(27)} ║`));
  console.log(chalk.cyan.bold(`╔═══════════════════════════════════════╗`));
  console.log();
}

export function printSuccess(message: string): void {
  console.log(chalk.green(`✓ ${message}`));
}

export function printError(message: string): void {
  console.log(chalk.red(`✗ ${message}`));
}

export function printWarning(message: string): void {
  console.log(chalk.yellow(`⚠ ${message}`));
}

export function printInfo(message: string): void {
  console.log(chalk.blue(`ℹ ${message}`));
}

export function printSection(title: string): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();
}

export function printKeyValue(key: string, value: string, indent: number = 0): void {
  const spaces = ' '.repeat(indent);
  console.log(`${spaces}${chalk.dim(key + ':')} ${value}`);
}

export function printUrlTable(urls: Record<string, string>): void {
  console.log();
  console.log(chalk.bold('Service URLs:'));
  console.log();

  const maxKeyLength = Math.max(...Object.keys(urls).map(k => k.length));

  for (const [service, url] of Object.entries(urls)) {
    const paddedService = service.padEnd(maxKeyLength);
    console.log(`  ${chalk.cyan(paddedService)}  ${chalk.blue.underline(url)}`);
  }

  console.log();
}
