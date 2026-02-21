import http from 'node:http';

export interface HttpResponse {
  status: number;
  body: string;
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<HttpResponse> {
  return httpRequest(url, 'GET', undefined, headers);
}

export async function httpPost(url: string, body: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
  return httpRequest(url, 'POST', body, headers);
}

function httpRequest(url: string, method: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqHeaders: Record<string, string> = { ...headers };
    let bodyStr: string | undefined;

    if (body !== undefined) {
      bodyStr = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr).toString();
    }

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout: 10_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

export async function waitForHttp(url: string, timeoutMs: number = 30_000, intervalMs: number = 1000): Promise<boolean> {
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await httpGet(url);
      if (res.status >= 200 && res.status < 500) return true;
    } catch {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}
