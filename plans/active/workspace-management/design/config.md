# Grove Workspace Management: Config

Last updated: 2026-02-14

## `.grove.yaml` Extension

The existing `.grove.yaml` gains an optional `workspace` section:

```yaml
workspace:
  repos:
    - path: public
      remote: git@github.com:brmatola/acorn.git
    - path: cloud
      remote: git@github.com:twiglylabs/acorn-cloud.git

# Existing grove config (optional — not all repos need K8s infra)
project:
  name: acorn
  cluster: twiglylabs-local
# ...
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `workspace.repos[].path` | Yes | Path relative to parent repo root where child lives |
| `workspace.repos[].remote` | No | Git remote URL. Used for documentation/future clone support. Not used during create. |

### Validation Rules

- `path` must not contain `..` or absolute paths
- `path` must point to an existing directory that is a git repo (has `.git`)
- `path` must be gitignored by the parent repo
- Duplicate paths are rejected

### Zod Schema

```typescript
const WorkspaceRepoSchema = z.object({
  path: z.string().min(1),
  remote: z.string().optional(),
});

const WorkspaceConfigSchema = z.object({
  repos: z.array(WorkspaceRepoSchema).min(1),
});
```

Add to existing `GroveConfigSchema` as optional:

```typescript
workspace: WorkspaceConfigSchema.optional(),
```

### Simple Workspaces (No Config)

When `grove workspace create` is run in a repo without a `workspace` section in `.grove.yaml` (or without `.grove.yaml` at all), it creates a simple single-repo workspace. No config file needed.

### Config Loading Path

The existing `loadConfig()` throws if `.grove.yaml` is missing — it's designed for K8s commands that require config. Workspace commands use a separate function:

```typescript
// New function — does NOT throw if file is missing
function loadWorkspaceConfig(repoRoot: string): WorkspaceConfig | null {
  const configPath = path.join(repoRoot, '.grove.yaml');
  if (!fs.existsSync(configPath)) return null;

  const raw = yaml.parse(fs.readFileSync(configPath, 'utf8'));
  const parsed = PartialGroveConfigSchema.safeParse(raw);
  if (!parsed.success) return null;

  return parsed.data.workspace ?? null;
}
```

This keeps the existing `loadConfig()` untouched. Workspace commands call `loadWorkspaceConfig()` instead.

### Detection

```typescript
function isGroupedWorkspace(config: WorkspaceConfig | null): boolean {
  return config?.repos != null && config.repos.length > 0;
}
```

When `.grove.yaml` has no `workspace` key, or when there's no `.grove.yaml` at all, the workspace is simple (single-repo).
