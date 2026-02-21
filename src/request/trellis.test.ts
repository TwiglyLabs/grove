import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { toTitle, parseTrellisConfig } from './trellis.js';

const testDir = join(tmpdir(), `grove-trellis-test-${process.pid}`);

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('toTitle', () => {
  it('capitalizes single segment', () => {
    expect(toTitle('a')).toBe('A');
  });

  it('capitalizes multi-segment kebab-case', () => {
    expect(toTitle('my-plan')).toBe('My Plan');
  });

  it('capitalizes segments with numbers', () => {
    expect(toTitle('fix-api-v2')).toBe('Fix Api V2');
  });
});

describe('parseTrellisConfig', () => {
  it('returns plans_dir value from valid config', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, '.trellis'), 'project: test\nplans_dir: specs');
    expect(parseTrellisConfig(testDir)).toBe('specs');
  });

  it('returns "plans" when .trellis file is missing', () => {
    mkdirSync(testDir, { recursive: true });
    expect(parseTrellisConfig(testDir)).toBe('plans');
  });

  it('returns "plans" when .trellis is malformed', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, '.trellis'), 'garbage content {{{');
    expect(parseTrellisConfig(testDir)).toBe('plans');
  });

  it('returns "plans" when .trellis has no plans_dir key', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, '.trellis'), 'project: test');
    expect(parseTrellisConfig(testDir)).toBe('plans');
  });

  it('returns "plans" when plans_dir value is empty', () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, '.trellis'), 'plans_dir: ');
    expect(parseTrellisConfig(testDir)).toBe('plans');
  });
});
