import { describe, it, expect, afterEach } from 'vitest';
import { waitForHealthResult } from './health.js';
import * as net from 'net';
import * as http from 'http';

describe('waitForHealthResult', () => {
  let server: http.Server;

  afterEach(() => {
    if (server) {
      server.close();
    }
  });

  it('returns healthy result when service responds', async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const result = await waitForHealthResult('test-service', 'http', '127.0.0.1', port, '/', 5, 100);

    expect(result.healthy).toBe(true);
    expect(result.target).toBe('test-service');
    expect(result.protocol).toBe('http');
    expect(result.port).toBe(port);
    expect(result.attempts).toBe(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('returns unhealthy result with error when service unreachable', async () => {
    const result = await waitForHealthResult('dead-service', 'http', '127.0.0.1', 59999, '/', 3, 50);

    expect(result.healthy).toBe(false);
    expect(result.target).toBe('dead-service');
    expect(result.attempts).toBe(3);
    expect(result.error).toBeDefined();
  });

  it('tracks attempts and elapsed time', async () => {
    let callCount = 0;
    server = http.createServer((req, res) => {
      callCount++;
      if (callCount < 3) {
        res.writeHead(500);
        res.end();
      } else {
        res.writeHead(200);
        res.end('ok');
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    const result = await waitForHealthResult('slow-service', 'http', '127.0.0.1', port, '/', 10, 50);

    // Note: checkHealth considers 500 as >= 500 so it returns false
    // Actually, the current checkHttpHealth returns true for 200-499, false for 500+
    // So 500 returns false, which means it should retry
    expect(result.healthy).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(3);
    expect(result.elapsedMs).toBeGreaterThan(0);
  });
});
