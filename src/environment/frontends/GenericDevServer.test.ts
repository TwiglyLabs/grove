import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GenericDevServer } from './GenericDevServer.js';
import { FrontendStartFailedError } from '../../shared/errors.js';

vi.mock('../health.js', () => ({
  checkHealth: vi.fn(() => Promise.resolve(true)),
}));

import { checkHealth } from '../health.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'grove-devserver-test-'));
  mkdirSync(join(tmpDir, 'app'), { recursive: true });
  mkdirSync(join(tmpDir, 'logs'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('GenericDevServer', () => {
  describe('start', () => {
    it('returns valid ProcessInfo for a successful start', async () => {
      const server = new GenericDevServer(
        { name: 'test-app', command: 'sleep 10', cwd: 'app' },
        3000,
      );

      const info = await server.start(tmpDir, join(tmpDir, 'logs'));

      expect(info.pid).toBeGreaterThan(0);
      expect(info.startedAt).toBeTruthy();

      // Clean up
      try { process.kill(info.pid, 'SIGKILL'); } catch {}
    });

    it('throws FrontendStartFailedError for a bad command', async () => {
      const server = new GenericDevServer(
        { name: 'bad-app', command: '/nonexistent/binary/that-does-not-exist-xyz', cwd: 'app' },
        3000,
      );

      await expect(server.start(tmpDir, join(tmpDir, 'logs'))).rejects.toThrow(FrontendStartFailedError);
    });

    it('handles commands with quoted arguments via shell', async () => {
      // Create a script that writes its args to a file
      const argsFile = join(tmpDir, 'args.txt');
      const command = `echo "hello world" > "${argsFile}" && sleep 10`;

      const server = new GenericDevServer(
        { name: 'quoted-app', command, cwd: 'app' },
        3000,
      );

      const info = await server.start(tmpDir, join(tmpDir, 'logs'));
      expect(info.pid).toBeGreaterThan(0);

      // Clean up
      try { process.kill(info.pid, 'SIGKILL'); } catch {}
    });
  });

  describe('stop', () => {
    it('returns killed:true for already-dead process', async () => {
      const server = new GenericDevServer(
        { name: 'test', command: 'sleep 10', cwd: 'app' },
        3000,
      );

      // Use a PID that is very unlikely to exist
      const result = await server.stop(2147483647, 500);
      expect(result.killed).toBe(true);
      expect(result.escalated).toBe(false);
    });

    it('escalates SIGTERM to SIGKILL', async () => {
      const server = new GenericDevServer(
        // trap SIGTERM so the process ignores it
        { name: 'stubborn', command: "trap '' TERM; sleep 60", cwd: 'app' },
        3000,
      );

      const info = await server.start(tmpDir, join(tmpDir, 'logs'));

      // Use a short timeout so escalation happens quickly
      const result = await server.stop(info.pid, 300);
      expect(result.killed).toBe(true);
      expect(result.escalated).toBe(true);
    }, 10000);
  });

  describe('isHealthy', () => {
    it('returns true when no health config', async () => {
      const server = new GenericDevServer(
        { name: 'test', command: 'sleep 10', cwd: 'app' },
        3000,
      );

      const healthy = await server.isHealthy();
      expect(healthy).toBe(true);
      expect(checkHealth).not.toHaveBeenCalled();
    });

    it('calls checkHealth when health config exists', async () => {
      const server = new GenericDevServer(
        { name: 'test', command: 'sleep 10', cwd: 'app', health: { path: '/health', protocol: 'http' } },
        3000,
      );

      const healthy = await server.isHealthy();
      expect(healthy).toBe(true);
      expect(checkHealth).toHaveBeenCalledWith('http', '127.0.0.1', 3000, '/health');
    });
  });
});
