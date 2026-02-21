## Public API
`src/request/api.ts` exports:
- `createRequest(target: RepoId, planName: string, opts: RequestOptions): Promise<RequestResult>` (moved from `src/api/request.ts`)
## Types
`src/request/types.ts` exports:
- `RequestOptions` — `{ body: string, description?: string, sourceRepo?: RepoId }`
- `RequestResult` — `{ file: string, worktree: string, branch: string, source: string | null, target: string }`

`src/api/types.ts` re-exports both types from `../request/types.js` for backwards compatibility.
## CLI subcommand
`src/request/cli.ts` exports:
- `requestCommand(args: string[]): Promise<void>` — follows repo-slice pattern (manual arg parsing, not a commander Command object)
- Supports: `--body <markdown>`, `--body-file <path>` (mutually exclusive), `--description <text>`, `--json`, `--help`
- Registered in `src/cli.ts` via `program.command('request').allowUnknownOption().action(async (_options, cmd) => requestCommand(cmd.args))`
