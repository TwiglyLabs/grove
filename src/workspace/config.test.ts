import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadWorkspaceConfig, WorkspaceConfigSchema, WorkspaceRepoSchema, SetupCommandSchema, HooksSchema } from './config.js';

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  };
});

describe('WorkspaceConfigSchema', () => {
  it('parses valid config with one repo', () => {
    const result = WorkspaceConfigSchema.safeParse({
      repos: [{ path: 'public' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty repos array', () => {
    const result = WorkspaceConfigSchema.safeParse({ repos: [] });
    expect(result.success).toBe(false);
  });

  it('accepts optional remote field', () => {
    const result = WorkspaceConfigSchema.safeParse({
      repos: [{ path: 'lib', remote: 'origin' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repos[0].remote).toBe('origin');
    }
  });

  it('rejects repo with empty path', () => {
    const result = WorkspaceRepoSchema.safeParse({ path: '' });
    expect(result.success).toBe(false);
  });

  it('accepts optional setup commands', () => {
    const result = WorkspaceConfigSchema.safeParse({
      repos: [{ path: 'api' }],
      setup: ['npm install', 'npm run codegen'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.setup).toEqual(['npm install', 'npm run codegen']);
    }
  });

  it('accepts optional hooks', () => {
    const result = WorkspaceConfigSchema.safeParse({
      repos: [{ path: 'api' }],
      hooks: { postCreate: './scripts/post-create.sh' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hooks?.postCreate).toBe('./scripts/post-create.sh');
    }
  });

  it('accepts config with both setup and hooks', () => {
    const result = WorkspaceConfigSchema.safeParse({
      repos: [{ path: 'api' }],
      setup: ['npm install'],
      hooks: {
        postCreate: './scripts/post-create.sh',
        preUp: './scripts/pre-up.sh',
        postUp: './scripts/post-up.sh',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects setup with empty string command', () => {
    const result = WorkspaceConfigSchema.safeParse({
      repos: [{ path: 'api' }],
      setup: [''],
    });
    expect(result.success).toBe(false);
  });
});

describe('SetupCommandSchema', () => {
  it('parses valid command array', () => {
    const result = SetupCommandSchema.safeParse(['npm install', 'npm run build']);
    expect(result.success).toBe(true);
  });

  it('accepts empty array', () => {
    const result = SetupCommandSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('rejects non-string elements', () => {
    const result = SetupCommandSchema.safeParse([123]);
    expect(result.success).toBe(false);
  });
});

describe('HooksSchema', () => {
  it('parses with all hooks', () => {
    const result = HooksSchema.safeParse({
      postCreate: './a.sh',
      preUp: './b.sh',
      postUp: './c.sh',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    const result = HooksSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe('loadWorkspaceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace config when file has workspace section', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'workspace:\n  repos:\n    - path: public\n    - path: cloud\n',
    );

    const result = loadWorkspaceConfig('/repos/project');

    expect(result).toEqual({
      repos: [{ path: 'public' }, { path: 'cloud' }],
    });
    expect(mockExistsSync).toHaveBeenCalledWith('/repos/project/.grove.yaml');
  });

  it('returns null when .grove.yaml does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(loadWorkspaceConfig('/repos/project')).toBeNull();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('returns null when YAML has no workspace section', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('project: my-project\nhelm:\n  chart: my-chart\n');

    expect(loadWorkspaceConfig('/repos/project')).toBeNull();
  });

  it('returns null for invalid YAML syntax', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(': : : not valid yaml [[[');

    expect(loadWorkspaceConfig('/repos/project')).toBeNull();
  });

  it('returns null when workspace section fails schema validation', () => {
    mockExistsSync.mockReturnValue(true);
    // repos must be a non-empty array
    mockReadFileSync.mockReturnValue('workspace:\n  repos: []\n');

    expect(loadWorkspaceConfig('/repos/project')).toBeNull();
  });

  it('passes through unknown top-level fields', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'project: my-project\nhelm:\n  chart: foo\nworkspace:\n  repos:\n    - path: lib\n',
    );

    const result = loadWorkspaceConfig('/repos/project');
    expect(result).toEqual({ repos: [{ path: 'lib' }] });
  });

  it('parses YAML with setup and hooks sections', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      [
        'workspace:',
        '  repos:',
        '    - path: api',
        '  setup:',
        '    - npm install',
        '    - npx prisma generate',
        '  hooks:',
        '    postCreate: ./scripts/post-create.sh',
        '    preUp: ./scripts/pre-up.sh',
      ].join('\n'),
    );

    const result = loadWorkspaceConfig('/repos/project');

    expect(result).toEqual({
      repos: [{ path: 'api' }],
      setup: ['npm install', 'npx prisma generate'],
      hooks: {
        postCreate: './scripts/post-create.sh',
        preUp: './scripts/pre-up.sh',
      },
    });
  });
});
