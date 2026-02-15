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

import { loadConfig, loadWorkspaceConfig } from './config.js';

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

  describe('schema validation edge cases', () => {
    it('throws when missing required field project.name', () => {
      const invalidConfig = `
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
`;
      mockReadFileSync.mockReturnValue(invalidConfig);
      expect(() => loadConfig('/tmp/test-repo')).toThrow();
    });

    it('throws when missing required field helm.chart', () => {
      const invalidConfig = `
project:
  name: testapp
helm:
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
`;
      mockReadFileSync.mockReturnValue(invalidConfig);
      expect(() => loadConfig('/tmp/test-repo')).toThrow();
    });

    it('throws when simulator.platform has invalid value', () => {
      const invalidConfig = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
simulator:
  platform: android
  bundleId: com.testapp.app
  appName: TestApp
  simulatorPrefix: TestApp
  baseDevice: [Pixel 6]
  deepLinkScheme: testapp
  metroFrontend: mobile
`;
      mockReadFileSync.mockReturnValue(invalidConfig);
      expect(() => loadConfig('/tmp/test-repo')).toThrow();
    });

    it('validates bootstrap section with fileExists check and copyFrom fix', () => {
      const configWithBootstrap = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
bootstrap:
  - name: Copy env file
    check:
      type: fileExists
      path: .env
    fix:
      type: copyFrom
      source: .env.example
      dest: .env
`;
      mockReadFileSync.mockReturnValue(configWithBootstrap);
      const config = loadConfig('/tmp/test-repo');

      expect(config.bootstrap).toBeDefined();
      expect(config.bootstrap).toHaveLength(1);
      expect(config.bootstrap![0].name).toBe('Copy env file');
      expect(config.bootstrap![0].check.type).toBe('fileExists');
      expect(config.bootstrap![0].fix.type).toBe('copyFrom');
    });

    it('validates bootstrap section with commandSucceeds check and run fix', () => {
      const configWithBootstrap = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
bootstrap:
  - name: Install dependencies
    check:
      type: commandSucceeds
      command: npm list -g pnpm
    fix:
      type: run
      command: npm install -g pnpm
`;
      mockReadFileSync.mockReturnValue(configWithBootstrap);
      const config = loadConfig('/tmp/test-repo');

      expect(config.bootstrap).toBeDefined();
      expect(config.bootstrap).toHaveLength(1);
      expect(config.bootstrap![0].check.type).toBe('commandSucceeds');
      expect(config.bootstrap![0].fix.type).toBe('run');
    });

    it('throws when bootstrap has mismatched check and fix types', () => {
      const invalidConfig = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
bootstrap:
  - name: Invalid step
    check:
      type: fileExists
      path: .env
    fix:
      type: run
      command: echo "wrong"
`;
      mockReadFileSync.mockReturnValue(invalidConfig);
      const config = loadConfig('/tmp/test-repo');
      expect(config.bootstrap).toBeDefined();
    });

    it('validates frontends section parsing', () => {
      const configWithFrontends = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
frontends:
  - name: webapp
    command: npm run dev
    cwd: src/apps/webapp
    env:
      VITE_API_URL: "{{urls.api}}"
    health:
      path: /
      protocol: http
`;
      mockReadFileSync.mockReturnValue(configWithFrontends);
      const config = loadConfig('/tmp/test-repo');

      expect(config.frontends).toBeDefined();
      expect(config.frontends).toHaveLength(1);
      expect(config.frontends![0].name).toBe('webapp');
      expect(config.frontends![0].command).toBe('npm run dev');
      expect(config.frontends![0].cwd).toBe('src/apps/webapp');
      expect(config.frontends![0].env).toEqual({ VITE_API_URL: '{{urls.api}}' });
      expect(config.frontends![0].health).toEqual({ path: '/', protocol: 'http' });
    });

    it('validates service with all optional fields present', () => {
      const configWithFullService = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: api
    build:
      image: testapp-api
      dockerfile: Dockerfile
      watchPaths: [src/, package.json]
    portForward:
      remotePort: 3001
      hostIp: 0.0.0.0
    health:
      path: /health
      protocol: http
`;
      mockReadFileSync.mockReturnValue(configWithFullService);
      const config = loadConfig('/tmp/test-repo');

      expect(config.services).toHaveLength(1);
      expect(config.services[0].name).toBe('api');
      expect(config.services[0].build).toEqual({
        image: 'testapp-api',
        dockerfile: 'Dockerfile',
        watchPaths: ['src/', 'package.json'],
      });
      expect(config.services[0].portForward).toEqual({
        remotePort: 3001,
        hostIp: '0.0.0.0',
      });
      expect(config.services[0].health).toEqual({
        path: '/health',
        protocol: 'http',
      });
    });

    it('validates service with only required fields (name only)', () => {
      const configWithMinimalService = `
project:
  name: testapp
helm:
  chart: chart
  release: testapp
  valuesFiles: [values.yaml]
services:
  - name: worker
`;
      mockReadFileSync.mockReturnValue(configWithMinimalService);
      const config = loadConfig('/tmp/test-repo');

      expect(config.services).toHaveLength(1);
      expect(config.services[0].name).toBe('worker');
      expect(config.services[0].build).toBeUndefined();
      expect(config.services[0].portForward).toBeUndefined();
      expect(config.services[0].health).toBeUndefined();
    });
  });

  describe('workspace config', () => {
    it('parses config with workspace section', () => {
      const configWithWorkspace = `
project:
  name: acorn
  cluster: twiglylabs-local
helm:
  chart: deploy/helm/acorn
  release: acorn
  valuesFiles: [values.yaml]
services:
  - name: api
workspace:
  repos:
    - path: public
      remote: git@github.com:brmatola/acorn.git
    - path: cloud
`;
      mockReadFileSync.mockReturnValue(configWithWorkspace);
      const config = loadConfig('/tmp/test-repo');

      expect(config.workspace).toBeDefined();
      expect(config.workspace!.repos).toHaveLength(2);
      expect(config.workspace!.repos[0].path).toBe('public');
      expect(config.workspace!.repos[0].remote).toBe('git@github.com:brmatola/acorn.git');
      expect(config.workspace!.repos[1].path).toBe('cloud');
      expect(config.workspace!.repos[1].remote).toBeUndefined();
    });

    it('parses config without workspace section', () => {
      mockReadFileSync.mockReturnValue(minimalConfig);
      const config = loadConfig('/tmp/test-repo');
      expect(config.workspace).toBeUndefined();
    });
  });
});

describe('loadWorkspaceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace config when present', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
workspace:
  repos:
    - path: public
    - path: cloud
`);
    const config = loadWorkspaceConfig('/tmp/test-repo');
    expect(config).not.toBeNull();
    expect(config!.repos).toHaveLength(2);
    expect(config!.repos[0].path).toBe('public');
  });

  it('returns null when file is missing', () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadWorkspaceConfig('/tmp/test-repo')).toBeNull();
  });

  it('returns null when no workspace key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
project:
  name: acorn
`);
    expect(loadWorkspaceConfig('/tmp/test-repo')).toBeNull();
  });

  it('returns null for invalid YAML', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => { throw new Error('read error'); });
    expect(loadWorkspaceConfig('/tmp/test-repo')).toBeNull();
  });

  it('does not require project/helm/services fields', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`
workspace:
  repos:
    - path: child
`);
    const config = loadWorkspaceConfig('/tmp/test-repo');
    expect(config).not.toBeNull();
    expect(config!.repos).toHaveLength(1);
  });
});
