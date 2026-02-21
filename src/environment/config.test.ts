import { describe, it, expect } from 'vitest';
import {
  ClusterTypeSchema,
  ProjectSchema,
  ServiceSchema,
  FrontendSchema,
  HelmSchema,
  BootstrapStepSchema,
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
