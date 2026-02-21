/**
 * Unit tests for smoke HTTP helper functions.
 *
 * Tests the retry/wait logic of waitForHttp and basic
 * request building without hitting a real server.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'node:http';

vi.mock('node:http');

import { waitForHttp, httpGet, httpPost } from './http.js';

const mockHttpRequest = vi.mocked(http.request);

function makeMockResponse(statusCode: number, body: string) {
  const res = {
    statusCode,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'data') cb(body);
      if (event === 'end') cb();
    }),
  };
  return res;
}

function makeMockRequest(response: ReturnType<typeof makeMockResponse>) {
  const req = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
  };
  mockHttpRequest.mockImplementation((_opts, cb) => {
    if (cb) (cb as (res: typeof response) => void)(response);
    return req as unknown as http.ClientRequest;
  });
  return req;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('httpGet', () => {
  it('resolves with status and body on success', async () => {
    const res = makeMockResponse(200, 'hello');
    makeMockRequest(res);

    const result = await httpGet('http://localhost:8080/health');

    expect(result.status).toBe(200);
    expect(result.body).toBe('hello');
  });

  it('resolves with non-200 status codes', async () => {
    const res = makeMockResponse(404, 'not found');
    makeMockRequest(res);

    const result = await httpGet('http://localhost:8080/missing');

    expect(result.status).toBe(404);
    expect(result.body).toBe('not found');
  });
});

describe('httpPost', () => {
  it('calls write with JSON body and resolves response', async () => {
    const res = makeMockResponse(201, '{"id":1}');
    const req = makeMockRequest(res);

    const result = await httpPost('http://localhost:8080/items', { name: 'test' });

    expect(req.write).toHaveBeenCalled();
    expect(result.status).toBe(201);
  });
});

describe('waitForHttp', () => {
  it('returns true immediately when URL responds with 2xx', async () => {
    const res = makeMockResponse(200, 'ok');
    makeMockRequest(res);

    const result = await waitForHttp('http://localhost:8080/', 5000, 100);

    expect(result).toBe(true);
  });

  it('returns true when URL responds with 4xx (service is up but returns client error)', async () => {
    const res = makeMockResponse(404, 'not found');
    makeMockRequest(res);

    const result = await waitForHttp('http://localhost:8080/', 5000, 100);

    expect(result).toBe(true);
  });

  it('returns false after exhausting retries when all requests fail', async () => {
    mockHttpRequest.mockImplementation((_opts, _cb) => {
      const req = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'error') cb(new Error('ECONNREFUSED'));
        }),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      return req as unknown as http.ClientRequest;
    });

    const result = await waitForHttp('http://localhost:8080/', 300, 100);

    expect(result).toBe(false);
  });

  it('returns true after retrying when URL eventually succeeds', async () => {
    let callCount = 0;
    mockHttpRequest.mockImplementation((_opts, cb) => {
      callCount++;
      const req = {
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (callCount < 3 && event === 'error') handler(new Error('ECONNREFUSED'));
        }),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
      if (callCount >= 3 && cb) {
        const res = makeMockResponse(200, 'ok');
        (cb as (res: typeof res) => void)(res);
      }
      return req as unknown as http.ClientRequest;
    });

    const result = await waitForHttp('http://localhost:8080/', 5000, 50);

    expect(result).toBe(true);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});
