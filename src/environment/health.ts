import { createConnection } from 'net';
import http from 'http';
import type { HealthCheckResult } from './types.js';

export async function checkHealth(
  protocol: 'http' | 'tcp',
  host: string,
  port: number,
  path?: string
): Promise<boolean> {
  if (protocol === 'tcp') {
    return checkTcpHealth(host, port);
  } else {
    return checkHttpHealth(host, port, path || '/');
  }
}

async function checkTcpHealth(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolve(true);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function checkHttpHealth(host: string, port: number, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        path,
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        const code = res.statusCode ?? 0;
        resolve(code >= 200 && code < 500);
      }
    );

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

export async function waitForHealth(
  protocol: 'http' | 'tcp',
  host: string,
  port: number,
  path?: string,
  maxAttempts: number = 30,
  intervalMs: number = 1000
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const healthy = await checkHealth(protocol, host, port, path);
    if (healthy) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function waitForHealthResult(
  target: string,
  protocol: 'http' | 'tcp',
  host: string,
  port: number,
  path?: string,
  maxAttempts: number = 30,
  intervalMs: number = 1000
): Promise<HealthCheckResult> {
  const start = Date.now();
  let attempts = 0;
  let lastError: string | undefined;

  for (let i = 0; i < maxAttempts; i++) {
    attempts++;
    try {
      const healthy = await checkHealth(protocol, host, port, path);
      if (healthy) {
        return {
          target,
          healthy: true,
          protocol,
          port,
          attempts,
          elapsedMs: Date.now() - start,
        };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return {
    target,
    healthy: false,
    protocol,
    port,
    attempts,
    elapsedMs: Date.now() - start,
    error: lastError || `Health check failed after ${maxAttempts} attempts`,
  };
}

export async function checkTcpReady(
  host: string,
  port: number,
  timeoutMs: number = 5000,
  intervalMs: number = 200
): Promise<boolean> {
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    const ready = await checkTcpHealth(host, port);
    if (ready) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}
