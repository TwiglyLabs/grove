import type { FailureDetail } from '../types.js';

interface ParseResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  failures: FailureDetail[];
}

/**
 * Parse JUnit XML test results (used by Maestro).
 * Regex-based, tolerant of attribute order and missing attributes.
 */
export function parseJunitXml(xmlContent: string | undefined): ParseResult {
  if (!xmlContent) {
    return { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  }

  // Parse attributes individually (order-agnostic, tolerant of missing attributes)
  const testsMatch = xmlContent.match(/<testsuite[^>]*\btests="(\d+)"/);
  const failuresMatch = xmlContent.match(/<testsuite[^>]*\bfailures="(\d+)"/);
  const errorsMatch = xmlContent.match(/<testsuite[^>]*\berrors="(\d+)"/);
  const skippedMatch = xmlContent.match(/<testsuite[^>]*\bskipped="(\d+)"/);

  if (!testsMatch) {
    return { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  }

  const total = parseInt(testsMatch[1], 10);
  const failed = (failuresMatch ? parseInt(failuresMatch[1], 10) : 0) +
                 (errorsMatch ? parseInt(errorsMatch[1], 10) : 0);
  const skipped = skippedMatch ? parseInt(skippedMatch[1], 10) : 0;
  const passed = total - failed - skipped;

  const failures: FailureDetail[] = [];
  // Match testcase elements that are NOT self-closing (i.e., have </testcase>)
  const failureTestcaseRegex = /<testcase([^>\/]*[^\/])>([\s\S]*?)<\/testcase>/g;
  let match;

  while ((match = failureTestcaseRegex.exec(xmlContent)) !== null) {
    const attributes = match[1];
    const testContent = match[2];

    // Only process if it contains a failure
    if (testContent.includes('<failure')) {
      const nameMatch = attributes.match(/name="([^"]*)"/);
      const testName = nameMatch ? nameMatch[1] : 'unknown';

      const messageAttrMatch = testContent.match(/<failure[^>]*message="([^"]*)"/);
      const innerTextMatch = testContent.match(/<failure[^>]*>([\s\S]*?)<\/failure>/);
      const message = messageAttrMatch
        ? messageAttrMatch[1] + (innerTextMatch ? '\n' + innerTextMatch[1].trim() : '')
        : innerTextMatch ? innerTextMatch[1].trim() : 'Test failed';
      failures.push({ test: testName, message });
    }
  }

  return { total, passed, failed, skipped, failures };
}

/**
 * Recursively collect all specs from nested Playwright suites.
 */
function collectSpecs(suites: any[]): any[] {
  const specs: any[] = [];
  for (const suite of suites) {
    if (suite.specs) {
      specs.push(...suite.specs);
    }
    if (suite.suites) {
      specs.push(...collectSpecs(suite.suites));
    }
  }
  return specs;
}

/**
 * Parse Playwright JSON test results.
 */
export function parsePlaywrightJson(jsonContent: string): ParseResult {
  try {
    const data = JSON.parse(jsonContent);
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures: FailureDetail[] = [];

    const allSpecs = collectSpecs(data.suites || []);

    for (const spec of allSpecs) {
      total++;

      // Check if ALL test entries in the spec are skipped
      const isSkipped = spec.tests?.length > 0 && spec.tests.every((test: any) => {
        const results = test.results || [];
        return results.length > 0 && results.every((r: any) => r.status === 'skipped');
      });

      if (isSkipped) {
        skipped++;
      } else if (spec.ok) {
        passed++;
      } else {
        failed++;
        const message = spec.tests?.[0]?.results?.[0]?.error?.message || 'Test failed';
        failures.push({ test: spec.title, message });
      }
    }

    return { total, passed, failed, skipped, failures };
  } catch {
    return { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  }
}

/**
 * Parse Vitest JSON test results.
 */
export function parseVitestJson(jsonContent: string): ParseResult {
  try {
    const data = JSON.parse(jsonContent);
    const total = data.numTotalTests || 0;
    const passed = data.numPassedTests || 0;
    const failed = data.numFailedTests || 0;
    const skipped = data.numPendingTests || 0;
    const failures: FailureDetail[] = [];

    if (data.testResults) {
      for (const testResult of data.testResults) {
        if (testResult.assertionResults) {
          for (const assertion of testResult.assertionResults) {
            if (assertion.status === 'failed') {
              const message = assertion.failureMessages?.[0] || 'Test failed';
              failures.push({ test: assertion.title, message, file: testResult.name });
            }
          }
        }
      }
    }

    return { total, passed, failed, skipped, failures };
  } catch {
    return { total: 0, passed: 0, failed: 0, skipped: 0, failures: [] };
  }
}
