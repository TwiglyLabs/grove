import { describe, it, expect } from 'vitest';
import {
  ClusterTypeSchema,
  ProjectSchema,
  ServiceSchema,
  FrontendSchema,
  HelmSchema,
  BootstrapStepSchema,
  PortForwardSchema,
  HookStepSchema,
  EnvironmentHooksSchema,
} from './config.js';

describe('ClusterTypeSchema', () => {
  it('defaults to "kind" when not specified', () => {
    const result = ClusterTypeSchema.parse(undefined);
    expect(result).toBe('kind');
  });

  it('accepts "kind"', () => {
    expect(ClusterTypeSchema.parse('kind')).toBe('kind');
  });

  it('accepts "k3s"', () => {
    expect(ClusterTypeSchema.parse('k3s')).toBe('k3s');
  });

  it('rejects invalid cluster type', () => {
    expect(() => ClusterTypeSchema.parse('docker-desktop')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => ClusterTypeSchema.parse('')).toThrow();
  });
});

describe('ProjectSchema', () => {
  it('parses minimal project with defaults', () => {
    const result = ProjectSchema.parse({
      name: 'my-project',
    });

    expect(result).toEqual({
      name: 'my-project',
      cluster: 'twiglylabs-local',
      clusterType: 'kind',
    });
  });

  it('parses project with explicit clusterType', () => {
    const result = ProjectSchema.parse({
      name: 'my-project',
      cluster: 'my-cluster',
      clusterType: 'k3s',
    });

    expect(result).toEqual({
      name: 'my-project',
      cluster: 'my-cluster',
      clusterType: 'k3s',
    });
  });

  it('rejects project without name', () => {
    expect(() => ProjectSchema.parse({
      cluster: 'my-cluster',
    })).toThrow();
  });

  it('rejects invalid clusterType in project', () => {
    expect(() => ProjectSchema.parse({
      name: 'my-project',
      clusterType: 'minikube',
    })).toThrow();
  });
});

describe('ServiceSchema', () => {
  it('parses minimal service', () => {
    const result = ServiceSchema.parse({ name: 'api' });
    expect(result.name).toBe('api');
    expect(result.build).toBeUndefined();
    expect(result.portForward).toBeUndefined();
  });

  it('parses service with build config', () => {
    const result = ServiceSchema.parse({
      name: 'api',
      build: {
        image: 'api:latest',
        dockerfile: 'Dockerfile',
        watchPaths: ['src/'],
      },
    });

    expect(result.build!.image).toBe('api:latest');
    expect(result.build!.watchPaths).toEqual(['src/']);
  });

  it('parses service with port forward', () => {
    const result = ServiceSchema.parse({
      name: 'api',
      portForward: { remotePort: 3000 },
    });

    expect(result.portForward!.remotePort).toBe(3000);
    expect(result.portForward!.hostIp).toBe('127.0.0.1');
  });
});

describe('PortForwardSchema', () => {
  it('accepts valid remotePort', () => {
    const result = PortForwardSchema.parse({ remotePort: 8080 });
    expect(result.remotePort).toBe(8080);
    expect(result.hostIp).toBe('127.0.0.1');
  });

  it('accepts remotePort at boundaries (1 and 65535)', () => {
    expect(PortForwardSchema.parse({ remotePort: 1 }).remotePort).toBe(1);
    expect(PortForwardSchema.parse({ remotePort: 65535 }).remotePort).toBe(65535);
  });

  it('rejects remotePort 0', () => {
    expect(() => PortForwardSchema.parse({ remotePort: 0 })).toThrow();
  });

  it('rejects remotePort above 65535', () => {
    expect(() => PortForwardSchema.parse({ remotePort: 99999 })).toThrow();
  });

  it('rejects non-integer remotePort', () => {
    expect(() => PortForwardSchema.parse({ remotePort: 3000.5 })).toThrow();
  });

  it('rejects negative remotePort', () => {
    expect(() => PortForwardSchema.parse({ remotePort: -1 })).toThrow();
  });

  it('accepts valid hostIp', () => {
    const result = PortForwardSchema.parse({ remotePort: 80, hostIp: '192.168.1.1' });
    expect(result.hostIp).toBe('192.168.1.1');
  });

  it('rejects malformed hostIp', () => {
    expect(() => PortForwardSchema.parse({ remotePort: 80, hostIp: 'locahost' })).toThrow();
  });

  it('rejects hostIp with wrong format', () => {
    expect(() => PortForwardSchema.parse({ remotePort: 80, hostIp: '127.0.01' })).toThrow();
  });

  it('defaults hostIp to 127.0.0.1', () => {
    const result = PortForwardSchema.parse({ remotePort: 3000 });
    expect(result.hostIp).toBe('127.0.0.1');
  });
});

describe('HelmSchema', () => {
  it('parses helm config', () => {
    const result = HelmSchema.parse({
      chart: './chart',
      release: 'my-release',
      valuesFiles: ['values.yaml', 'values-dev.yaml'],
    });

    expect(result.chart).toBe('./chart');
    expect(result.valuesFiles).toHaveLength(2);
    expect(result.secretsTemplate).toBeUndefined();
  });

  it('parses helm config with secrets template', () => {
    const result = HelmSchema.parse({
      chart: './chart',
      release: 'my-release',
      valuesFiles: ['values.yaml'],
      secretsTemplate: 'secrets.yaml.tpl',
    });

    expect(result.secretsTemplate).toBe('secrets.yaml.tpl');
  });

  it('defaults wait to undefined (truthy behavior)', () => {
    const result = HelmSchema.parse({
      chart: './chart',
      release: 'my-release',
      valuesFiles: ['values.yaml'],
    });

    expect(result.wait).toBeUndefined();
  });

  it('accepts wait: false', () => {
    const result = HelmSchema.parse({
      chart: './chart',
      release: 'my-release',
      valuesFiles: ['values.yaml'],
      wait: false,
    });

    expect(result.wait).toBe(false);
  });
});

describe('BootstrapStepSchema', () => {
  it('parses fileExists check with copyFrom fix', () => {
    const result = BootstrapStepSchema.parse({
      name: 'env file',
      check: { type: 'fileExists', path: '.env' },
      fix: { type: 'copyFrom', source: '.env.example', dest: '.env' },
    });

    expect(result.name).toBe('env file');
    expect(result.check.type).toBe('fileExists');
    expect(result.fix.type).toBe('copyFrom');
  });

  it('parses commandSucceeds check with run fix', () => {
    const result = BootstrapStepSchema.parse({
      name: 'deps',
      check: { type: 'commandSucceeds', command: 'test -d node_modules' },
      fix: { type: 'run', command: 'npm install' },
    });

    expect(result.check.type).toBe('commandSucceeds');
    expect(result.fix.type).toBe('run');
  });
});

describe('HookStepSchema', () => {
  it('parses valid hook step', () => {
    const result = HookStepSchema.parse({
      name: 'Generate CRDs',
      command: 'docker run --rm gateway-gen',
    });
    expect(result.name).toBe('Generate CRDs');
    expect(result.command).toBe('docker run --rm gateway-gen');
  });

  it('rejects hook step without name', () => {
    expect(() => HookStepSchema.parse({ command: 'echo hi' })).toThrow();
  });

  it('rejects hook step without command', () => {
    expect(() => HookStepSchema.parse({ name: 'test' })).toThrow();
  });
});

describe('EnvironmentHooksSchema', () => {
  it('parses hooks with pre-deploy array', () => {
    const result = EnvironmentHooksSchema.parse({
      'pre-deploy': [
        { name: 'Hook 1', command: 'echo 1' },
        { name: 'Hook 2', command: 'echo 2' },
      ],
    });
    expect(result['pre-deploy']).toHaveLength(2);
  });

  it('parses hooks with empty pre-deploy array', () => {
    const result = EnvironmentHooksSchema.parse({ 'pre-deploy': [] });
    expect(result['pre-deploy']).toEqual([]);
  });

  it('parses hooks without pre-deploy (optional)', () => {
    const result = EnvironmentHooksSchema.parse({});
    expect(result['pre-deploy']).toBeUndefined();
  });
});
