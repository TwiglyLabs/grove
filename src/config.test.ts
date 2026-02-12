import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExistsSync, mockReadFileSync, mockExecSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => true),
  mockReadFileSync: vi.fn(),
  mockExecSync: vi.fn(() => '/tmp/test-repo'),
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

import { loadConfig } from './config.js';

const minimalConfig = `
project:
  name: testapp
  cluster: twiglylabs-local
helm:
  chart: deploy/helm/testapp
  release: testapp
  valuesFiles:
    - deploy/helm/testapp/values.yaml
services:
  - name: api
    build:
      image: testapp-api
      dockerfile: Dockerfile
    portForward:
      remotePort: 3001
    health:
      path: /health
      protocol: http
`;

const fullConfig = `
project:
  name: testapp
  cluster: twiglylabs-local
helm:
  chart: deploy/helm/testapp
  release: testapp
  valuesFiles:
    - deploy/helm/testapp/values.yaml
services:
  - name: api
    build:
      image: testapp-api
      dockerfile: Dockerfile
    portForward:
      remotePort: 3001
    health:
      path: /health
      protocol: http
frontends:
  - name: webapp
    command: npx vite --host
    cwd: src/apps/webapp
    env:
      VITE_API_URL: "{{urls.api}}"
testing:
  mobile:
    runner: maestro
    basePath: src/e2e/mobile/maestro
    suites:
      - name: smoke
        paths: [flows/smoke]
    envVars:
      API_URL: "{{urls.api}}"
  webapp:
    runner: playwright
    cwd: src/e2e/webapp
  api:
    runner: vitest
    cwd: src/e2e/api
  observability:
    serviceName: testapp-api
    traceEndpoint: "{{urls.jaeger}}"
  historyDir: .grove/test-history
  historyLimit: 5
  defaultTimeout: 120000
simulator:
  platform: ios
  bundleId: com.testapp.app
  appName: TestApp
  simulatorPrefix: TestApp
  baseDevice: [iPhone 15 Pro, iPhone 16 Pro]
  deepLinkScheme: testapp
  metroFrontend: mobile
utilities:
  shellTargets:
    - name: api
    - name: worker
      podSelector: app=background-worker
      shell: /bin/bash
  reloadTargets: [api, worker]
`;

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
  });

  it('parses minimal config without new sections', () => {
    mockReadFileSync.mockReturnValue(minimalConfig);
    const config = loadConfig('/tmp/test-repo');

    expect(config.project.name).toBe('testapp');
    expect(config.services).toHaveLength(1);
    expect(config.testing).toBeUndefined();
    expect(config.simulator).toBeUndefined();
    expect(config.utilities).toBeUndefined();
  });

  it('parses full config with all new sections', () => {
    mockReadFileSync.mockReturnValue(fullConfig);
    const config = loadConfig('/tmp/test-repo');

    expect(config.project.name).toBe('testapp');
    expect(config.testing).toBeDefined();
    expect(config.simulator).toBeDefined();
    expect(config.utilities).toBeDefined();
  });

  it('parses testing section correctly', () => {
    mockReadFileSync.mockReturnValue(fullConfig);
    const config = loadConfig('/tmp/test-repo');

    expect(config.testing!.mobile!.runner).toBe('maestro');
    expect(config.testing!.mobile!.basePath).toBe('src/e2e/mobile/maestro');
    expect(config.testing!.mobile!.suites).toHaveLength(1);
    expect(config.testing!.mobile!.suites![0].name).toBe('smoke');
    expect(config.testing!.mobile!.suites![0].paths).toEqual(['flows/smoke']);
    expect(config.testing!.mobile!.envVars).toEqual({ API_URL: '{{urls.api}}' });

    expect(config.testing!.webapp!.runner).toBe('playwright');
    expect(config.testing!.webapp!.cwd).toBe('src/e2e/webapp');

    expect(config.testing!.api!.runner).toBe('vitest');
    expect(config.testing!.api!.cwd).toBe('src/e2e/api');

    expect(config.testing!.observability!.serviceName).toBe('testapp-api');
    expect(config.testing!.historyDir).toBe('.grove/test-history');
    expect(config.testing!.historyLimit).toBe(5);
    expect(config.testing!.defaultTimeout).toBe(120000);
  });

  it('applies defaults for testing section', () => {
    const configWithTestingDefaults = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
testing:
  api:
    runner: vitest
    cwd: src/e2e/api
`;
    mockReadFileSync.mockReturnValue(configWithTestingDefaults);
    const config = loadConfig('/tmp/test-repo');

    expect(config.testing!.historyDir).toBe('.grove/test-history');
    expect(config.testing!.historyLimit).toBe(10);
    expect(config.testing!.defaultTimeout).toBe(300000);
  });

  it('parses simulator section correctly', () => {
    mockReadFileSync.mockReturnValue(fullConfig);
    const config = loadConfig('/tmp/test-repo');

    expect(config.simulator!.platform).toBe('ios');
    expect(config.simulator!.bundleId).toBe('com.testapp.app');
    expect(config.simulator!.appName).toBe('TestApp');
    expect(config.simulator!.simulatorPrefix).toBe('TestApp');
    expect(config.simulator!.baseDevice).toEqual(['iPhone 15 Pro', 'iPhone 16 Pro']);
    expect(config.simulator!.deepLinkScheme).toBe('testapp');
    expect(config.simulator!.metroFrontend).toBe('mobile');
  });

  it('parses utilities section correctly', () => {
    mockReadFileSync.mockReturnValue(fullConfig);
    const config = loadConfig('/tmp/test-repo');

    expect(config.utilities!.shellTargets).toHaveLength(2);
    expect(config.utilities!.shellTargets![0].name).toBe('api');
    expect(config.utilities!.shellTargets![0].podSelector).toBeUndefined();
    expect(config.utilities!.shellTargets![1].name).toBe('worker');
    expect(config.utilities!.shellTargets![1].podSelector).toBe('app=background-worker');
    expect(config.utilities!.shellTargets![1].shell).toBe('/bin/bash');
    expect(config.utilities!.reloadTargets).toEqual(['api', 'worker']);
  });

  it('computes portBlockSize correctly', () => {
    mockReadFileSync.mockReturnValue(fullConfig);
    const config = loadConfig('/tmp/test-repo');

    // 1 service with portForward + 1 frontend + 1 buffer = 3
    expect(config.portBlockSize).toBe(3);
  });

  it('rejects invalid config', () => {
    mockReadFileSync.mockReturnValue('invalid: yaml: that: lacks: required: fields');
    expect(() => loadConfig('/tmp/test-repo')).toThrow();
  });

  it('throws when config file not found', () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => loadConfig('/tmp/test-repo')).toThrow('Config file not found');
  });
});
