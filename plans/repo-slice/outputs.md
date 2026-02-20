## Public API

`src/repo/api.ts` exports:
- `add(path: string): Promise<RepoEntry>` — register a repo by filesystem path
- `remove(id: RepoId): Promise<void>` — unregister a repo
- `list(): Promise<RepoListEntry[]>` — list all registered repos with status
- `findByPath(path: string): Promise<RepoEntry | null>` — look up repo by path
- `get(id: RepoId): Promise<RepoEntry>` — get a single repo by ID

## Types

`src/repo/types.ts` exports:
- `RepoEntry` — `{ id: RepoId, name: string, path: string, addedAt: string }`
- `RepoListEntry` — extends `RepoEntry` with `{ exists: boolean, workspaceCount: number }`

## CLI subcommand

`src/repo/cli.ts` exports a commander `Command` for `grove repo` with subcommands `add`, `remove`, `list`.

## Pattern established

This slice is the reference implementation for the vertical slice convention. All subsequent slices follow the same structure: `types.ts`, `state.ts`, `api.ts`, `cli.ts`, colocated tests.
