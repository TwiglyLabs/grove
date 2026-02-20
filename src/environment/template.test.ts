import { describe, it, expect } from 'vitest';
import { resolveTemplates } from './template.js';
import type { EnvironmentState } from './types.js';

const makeState = (): EnvironmentState => ({
  namespace: 'testapp-test-branch',
  branch: 'test-branch',
  worktreeId: 'test-branch',
  ports: {
    api: 10000,
    auth: 10001,
    webapp: 10002,
  },
  urls: {
    api: 'http://127.0.0.1:10000',
    auth: 'http://127.0.0.1:10001',
    webapp: 'http://127.0.0.1:10002',
  },
  processes: {},
  lastEnsure: '2026-02-11T10:00:00Z',
});

describe('resolveTemplates', () => {
  it('resolves {{ports.serviceName}} to the port number from state', () => {
    const env = {
      API_PORT: '{{ports.api}}',
      AUTH_PORT: '{{ports.auth}}',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({
      API_PORT: '10000',
      AUTH_PORT: '10001',
    });
  });

  it('resolves {{urls.serviceName}} to the URL from state', () => {
    const env = {
      API_URL: '{{urls.api}}',
      AUTH_URL: '{{urls.auth}}',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({
      API_URL: 'http://127.0.0.1:10000',
      AUTH_URL: 'http://127.0.0.1:10001',
    });
  });

  it('leaves unresolved templates unchanged', () => {
    const env = {
      API_PORT: '{{ports.nonexistent}}',
      UNKNOWN_URL: '{{urls.notfound}}',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({
      API_PORT: '{{ports.nonexistent}}',
      UNKNOWN_URL: '{{urls.notfound}}',
    });
  });

  it('handles strings with no templates (passthrough)', () => {
    const env = {
      PLAIN_VALUE: 'just a string',
      NUMBER_VALUE: '12345',
      URL_VALUE: 'http://example.com',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual(env);
  });

  it('handles multiple templates in one value', () => {
    const env = {
      COMBINED: 'api={{urls.api}},auth={{urls.auth}},port={{ports.api}}',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({
      COMBINED: 'api=http://127.0.0.1:10000,auth=http://127.0.0.1:10001,port=10000',
    });
  });

  it('handles empty env object', () => {
    const env = {};

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({});
  });

  it('handles missing ports in state', () => {
    const state: EnvironmentState = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: {},
      urls: {
        api: 'http://127.0.0.1:10000',
      },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    const env = {
      API_PORT: '{{ports.api}}',
    };

    const result = resolveTemplates(env, state);

    expect(result).toEqual({
      API_PORT: '{{ports.api}}',
    });
  });

  it('handles missing urls in state', () => {
    const state: EnvironmentState = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: {
        api: 10000,
      },
      urls: {},
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    const env = {
      API_URL: '{{urls.api}}',
    };

    const result = resolveTemplates(env, state);

    expect(result).toEqual({
      API_URL: '{{urls.api}}',
    });
  });

  it('handles mixed resolved and unresolved templates', () => {
    const env = {
      EXISTING: '{{urls.api}}',
      MISSING: '{{urls.missing}}',
      PLAIN: 'no template',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({
      EXISTING: 'http://127.0.0.1:10000',
      MISSING: '{{urls.missing}}',
      PLAIN: 'no template',
    });
  });

  it('handles templates within larger strings', () => {
    const env = {
      CONFIG: 'Connect to API at {{urls.api}}/v1 on port {{ports.api}}',
    };

    const result = resolveTemplates(env, makeState());

    expect(result).toEqual({
      CONFIG: 'Connect to API at http://127.0.0.1:10000/v1 on port 10000',
    });
  });

  it('preserves template format when value is undefined', () => {
    const state: EnvironmentState = {
      namespace: 'testapp-test-branch',
      branch: 'test-branch',
      worktreeId: 'test-branch',
      ports: {
        api: undefined as any,
      },
      urls: {
        api: undefined as any,
      },
      processes: {},
      lastEnsure: '2026-02-11T10:00:00Z',
    };

    const env = {
      API_PORT: '{{ports.api}}',
      API_URL: '{{urls.api}}',
    };

    const result = resolveTemplates(env, state);

    expect(result).toEqual({
      API_PORT: '{{ports.api}}',
      API_URL: '{{urls.api}}',
    });
  });
});
