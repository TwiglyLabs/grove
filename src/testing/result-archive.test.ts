import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { archiveResults, pruneHistory } from './result-archive.js';
import type { GroveConfig } from '../config.js';

const testDir = join(tmpdir(), `grove-result-archive-test-${process.pid}`);

function makeConfig(overrides?: Partial<GroveConfig>): GroveConfig {
  return {
    project: { name: 'test-project', cluster: 'test-cluster' },
    repoRoot: testDir,
    helm: { chart: './chart', release: 'test', valuesFiles: [] },
    services: [],
    portBlockSize: 5,
    ...overrides,
  } as GroveConfig;
}

describe('result-archive', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('archiveResults', () => {
    it('creates archive directory with timestamp', () => {
      const outputDir = join(testDir, 'output');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'results.json'), '{"passed": true}');

      const config = makeConfig();
      archiveResults('api', 'default', outputDir, config);

      const historyDir = join(testDir, '.grove', 'test-history');
      expect(existsSync(historyDir)).toBe(true);

      const entries = readdirSync(historyDir);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*-api$/);
    });

    it('includes suite name for non-default suites', () => {
      const outputDir = join(testDir, 'output');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'results.json'), '{}');

      const config = makeConfig();
      archiveResults('mobile', 'smoke', outputDir, config);

      const historyDir = join(testDir, '.grove', 'test-history');
      const entries = readdirSync(historyDir);
      expect(entries[0]).toContain('-mobile-smoke');
    });

    it('uses custom historyDir from config', () => {
      const outputDir = join(testDir, 'output');
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(join(outputDir, 'results.json'), '{}');

      const config = makeConfig({
        testing: {
          historyDir: '.grove/custom-history',
          historyLimit: 10,
          defaultTimeout: 300000,
        },
      } as Partial<GroveConfig>);
      archiveResults('api', 'default', outputDir, config);

      expect(existsSync(join(testDir, '.grove', 'custom-history'))).toBe(true);
    });
  });

  describe('pruneHistory', () => {
    it('keeps entries under limit', () => {
      const historyDir = join(testDir, 'history');
      mkdirSync(historyDir, { recursive: true });

      mkdirSync(join(historyDir, '2024-01-01T10-00-00-api'), { recursive: true });
      mkdirSync(join(historyDir, '2024-01-02T10-00-00-api'), { recursive: true });

      pruneHistory(historyDir, 5);

      const remaining = readdirSync(historyDir);
      expect(remaining).toHaveLength(2);
    });

    it('deletes oldest entries when over limit', () => {
      const historyDir = join(testDir, 'history');
      mkdirSync(historyDir, { recursive: true });

      mkdirSync(join(historyDir, '2024-01-01T10-00-00-api'));
      mkdirSync(join(historyDir, '2024-01-02T10-00-00-api'));
      mkdirSync(join(historyDir, '2024-01-03T10-00-00-api'));
      mkdirSync(join(historyDir, '2024-01-04T10-00-00-api'));

      pruneHistory(historyDir, 2);

      const remaining = readdirSync(historyDir);
      expect(remaining).toHaveLength(2);
      expect(remaining).toContain('2024-01-03T10-00-00-api');
      expect(remaining).toContain('2024-01-04T10-00-00-api');
    });

    it('ignores non-timestamped directories', () => {
      const historyDir = join(testDir, 'history');
      mkdirSync(historyDir, { recursive: true });

      mkdirSync(join(historyDir, '2024-01-01T10-00-00-api'));
      mkdirSync(join(historyDir, '2024-01-02T10-00-00-api'));
      mkdirSync(join(historyDir, 'some-other-dir'));

      pruneHistory(historyDir, 1);

      const remaining = readdirSync(historyDir);
      // should keep: 1 timestamped entry + the non-timestamped dir
      expect(remaining).toContain('some-other-dir');
      expect(remaining).toContain('2024-01-02T10-00-00-api');
      expect(remaining).not.toContain('2024-01-01T10-00-00-api');
    });

    it('handles non-existent directory', () => {
      // Should not throw
      pruneHistory(join(testDir, 'nonexistent'), 5);
    });

    it('handles empty directory', () => {
      const historyDir = join(testDir, 'empty-history');
      mkdirSync(historyDir, { recursive: true });

      // Should not throw
      pruneHistory(historyDir, 5);

      expect(readdirSync(historyDir)).toHaveLength(0);
    });
  });
});
