import { describe, it, expect } from 'vitest';
import { parseJunitXml, parsePlaywrightJson, parseVitestJson } from './result-parsers.js';

describe('parseJunitXml', () => {
  it('returns zeros for undefined input', () => {
    const result = parseJunitXml(undefined);
    expect(result).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, failures: [] });
  });

  it('returns zeros for empty string', () => {
    const result = parseJunitXml('');
    expect(result).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, failures: [] });
  });

  it('parses valid JUnit XML with failures', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="maestro" tests="5" failures="1" errors="0" skipped="0">
    <testcase name="test1" classname="flow1" />
    <testcase name="test2" classname="flow2">
      <failure message="Expected element not found">
        Element with id 'login-button' not found
      </failure>
    </testcase>
    <testcase name="test3" classname="flow3" />
    <testcase name="test4" classname="flow4" />
    <testcase name="test5" classname="flow5" />
  </testsuite>
</testsuites>`;

    const result = parseJunitXml(xml);
    expect(result.total).toBe(5);
    expect(result.passed).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].test).toBe('test2');
    expect(result.failures[0].message).toContain('Expected element not found');
  });

  it('parses JUnit XML with all passing tests', () => {
    const xml = `<testsuite tests="3" failures="0" errors="0">
    <testcase name="t1" classname="c1" />
    <testcase name="t2" classname="c2" />
    <testcase name="t3" classname="c3" />
  </testsuite>`;

    const result = parseJunitXml(xml);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it('sums errors and failures', () => {
    const xml = `<testsuite tests="5" failures="1" errors="2" skipped="1">
    <testcase name="t1" classname="c1" />
  </testsuite>`;

    const result = parseJunitXml(xml);
    expect(result.total).toBe(5);
    expect(result.failed).toBe(3); // 1 failure + 2 errors
    expect(result.skipped).toBe(1);
    expect(result.passed).toBe(1); // 5 - 3 - 1
  });
});

describe('parsePlaywrightJson', () => {
  it('returns zeros for invalid JSON', () => {
    const result = parsePlaywrightJson('not json');
    expect(result).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, failures: [] });
  });

  it('parses Playwright JSON with mixed results', () => {
    const json = JSON.stringify({
      suites: [{
        specs: [
          { title: 'test1', ok: true },
          { title: 'test2', ok: false, tests: [{ results: [{ error: { message: 'Assertion failed' } }] }] },
          { title: 'test3', ok: true },
        ]
      }]
    });

    const result = parsePlaywrightJson(json);
    expect(result.total).toBe(3);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].test).toBe('test2');
    expect(result.failures[0].message).toBe('Assertion failed');
  });

  it('handles empty suites', () => {
    const result = parsePlaywrightJson(JSON.stringify({ suites: [] }));
    expect(result.total).toBe(0);
  });
});

describe('parseVitestJson', () => {
  it('returns zeros for invalid JSON', () => {
    const result = parseVitestJson('not json');
    expect(result).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, failures: [] });
  });

  it('parses Vitest JSON with failures', () => {
    const json = JSON.stringify({
      numTotalTests: 10,
      numPassedTests: 8,
      numFailedTests: 2,
      numPendingTests: 0,
      testResults: [
        {
          name: 'test1.test.ts',
          assertionResults: [
            { status: 'passed', title: 'test1' },
            { status: 'failed', title: 'test2', failureMessages: ['Expected 2 to be 3'] },
          ]
        }
      ]
    });

    const result = parseVitestJson(json);
    expect(result.total).toBe(10);
    expect(result.passed).toBe(8);
    expect(result.failed).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].test).toBe('test2');
    expect(result.failures[0].message).toBe('Expected 2 to be 3');
    expect(result.failures[0].file).toBe('test1.test.ts');
  });

  it('handles all passing tests', () => {
    const json = JSON.stringify({
      numTotalTests: 5,
      numPassedTests: 5,
      numFailedTests: 0,
      numPendingTests: 0,
      testResults: []
    });

    const result = parseVitestJson(json);
    expect(result.total).toBe(5);
    expect(result.passed).toBe(5);
    expect(result.failures).toHaveLength(0);
  });
});
