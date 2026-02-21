# Grove

Config-driven local Kubernetes development tool.

## Overview

Grove manages local Kubernetes development environments with:

- Automated kind cluster setup
- Branch-based namespace isolation
- Dynamic port allocation
- Helm-based deployments
- Port forwarding management
- Frontend dev server orchestration
- File watching and auto-rebuild
- Health checking
- Multi-repo workspace management
- Cross-repo request tracking
- iOS simulator management

## Installation

```bash
cd grove
npm install
npm run build
npm link  # Makes `grove` command available globally
```

## Configuration

Create a `.grove.yaml` in your repository root:

```yaml
project:
  name: myapp
  cluster: twiglylabs-local

helm:
  chart: deploy/helm/myapp
  release: myapp
  valuesFiles:
    - deploy/helm/values.yaml

services:
  - name: api
    build:
      image: myapp/api:local
      dockerfile: services/api/Dockerfile
      watchPaths:
        - services/api/src
    portForward:
      remotePort: 8080
    health:
      path: /health
      protocol: http

frontends:
  - name: webapp
    command: npm run dev
    cwd: frontends/webapp
    health:
      path: /
      protocol: http
```

## CLI Commands

### Environment

```bash
grove up                    # Start the development environment
grove up --frontend webapp  # Start specific frontend only
grove up --all              # Start all frontends
grove down                  # Stop all processes
grove destroy               # Stop processes and delete namespace
grove status                # Show environment status
grove watch                 # Watch for file changes and rebuild
grove prune                 # Clean up orphaned resources
grove reload [service]      # Trigger service reload
```

### Services

```bash
grove logs <service>        # Show logs for a service
grove logs <service> --pod  # Show kubectl pod logs
grove shell [service]       # Open shell in a service pod
grove test <platform>       # Run tests (mobile|webapp|api)
```

### Repos and Workspaces

```bash
grove repo add [path]       # Register a repo
grove repo remove <name>    # Remove a repo
grove repo list             # List registered repos
grove workspace create      # Create a multi-repo workspace
grove workspace list        # List workspaces
grove workspace status      # Show workspace status
grove workspace sync        # Sync workspace branches
grove workspace close       # Close a workspace
grove request               # File a cross-repo plan request
```

## Library API

Grove can be used as a library:

```typescript
import { environment, workspace, repo } from '@twiglylabs/grove'

// Start environment
const result = await environment.up(repoId, options)

// List workspaces
const workspaces = await workspace.list(options)

// Register a repo
const entry = await repo.add('/path/to/repo')
```

## Architecture

Grove uses a **vertical slice architecture**. Each domain owns its schema, commands, API surface, and tests:

```
src/
  shared/         Cross-cutting infrastructure (identity, errors, output, config)
  repo/           Repo registry management
  workspace/      Multi-repo workspace operations
  environment/    Environment lifecycle (up, down, destroy, watch)
  testing/        Test runner and result parsing
  simulator/      iOS simulator management
  shell/          Shell into service pods
  logs/           Log streaming
  request/        Cross-repo plan requests
  config.ts       Root config compositor (zod schemas from slices)
  cli.ts          Commander CLI skeleton
  lib.ts          Public library API (re-exports from slices)
  index.ts        CLI entry point
```

## Development

```bash
npm test              # Run all tests (vitest)
npm run test:watch    # Watch mode
npm run build         # TypeScript build
npm run lint          # Type-check without emit
```

## License

MIT
