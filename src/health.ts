import { createConnection } from 'net';
import http from 'http';

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
