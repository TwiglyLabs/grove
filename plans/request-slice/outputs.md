## Public API

`src/request/api.ts` exports:
- `create(target: RepoId | string, planName: string, opts: RequestOptions): Promise<RequestResult>`

## Types

`src/request/types.ts` exports:
- `RequestOptions` — `{ body: string, description?: string, sourceRepo?: RepoId }`
- `RequestResult` — `{ file: string, worktree: string, branch: string, source: string | null, target: string }`

## CLI subcommand

`src/request/cli.ts` exports a commander `Command` for `grove request <target> <plan>` with `--body`, `--description`, `--json` options.
