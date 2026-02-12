# Grove

Config-driven local Kubernetes development tool extracted from Rithmly's local-dev infrastructure.

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
  cluster: twiglylabs-local  # optional, defaults to twiglylabs-local

helm:
  chart: deploy/helm/myapp
  release: myapp
  valuesFiles:
    - deploy/helm/values.yaml
  secretsTemplate: deploy/helm/secrets.yaml  # optional

services:
  - name: api
    build:
      image: myapp/api:local
      dockerfile: services/api/Dockerfile
      watchPaths:
        - services/api/src
    portForward:
      remotePort: 8080
      hostIp: 127.0.0.1  # optional, defaults to 127.0.0.1
    health:
      path: /health
      protocol: http  # or tcp

  - name: worker
    build:
      image: myapp/worker:local
      dockerfile: services/worker/Dockerfile
    portForward:
      remotePort: 9090
    health:
      protocol: tcp

frontends:
  - name: webapp
    command: npm run dev
    cwd: frontends/webapp
    env:
      VITE_API_URL: http://localhost:10000
    health:
      path: /
      protocol: http

bootstrap:
  - name: Ensure .env file
    check:
      type: fileExists
      path: .env
    fix:
      type: copyFrom
      source: .env.example
      dest: .env

  - name: Install dependencies
    check:
      type: commandSucceeds
      command: test -d node_modules
    fix:
      type: run
      command: npm install
```

## Usage

### Start environment

```bash
grove up
```

This will:
1. Ensure kind cluster exists
2. Run bootstrap checks
3. Allocate ports for this branch
4. Build Docker images
5. Load images to kind
6. Deploy with Helm
7. Start port forwards
8. Start frontend dev servers
9. Health check all services

### Check status

```bash
grove status
```

Shows running processes, ports, and URLs.

### Watch for changes

```bash
grove watch
```

Watches configured paths and rebuilds/redeploys on changes.

### View logs

```bash
grove logs api
grove logs webapp
```

### Stop processes

```bash
grove down
```

Stops all port forwards and dev servers but keeps the namespace.

### Destroy environment

```bash
grove destroy
```

Stops processes and deletes the Kubernetes namespace.

### Clean up orphaned resources

```bash
grove prune
```

Removes namespaces that don't have corresponding state files.

## Architecture

### Port Allocation

Each branch/worktree gets a unique port block. Ports are allocated starting from 10000 in blocks sized to accommodate all services and frontends. The allocation is persisted in `.grove/<worktree-id>.json`.

### State Management

State files are stored in `.grove/` directory:

```json
{
  "namespace": "myapp-main",
  "branch": "main",
  "worktreeId": "main",
  "ports": {
    "api": 10000,
    "worker": 10001,
    "webapp": 10002
  },
  "urls": {
    "api": "http://127.0.0.1:10000",
    "worker": "tcp://127.0.0.1:10001",
    "webapp": "http://127.0.0.1:10002"
  },
  "processes": {
    "port-forward-api": {
      "pid": 12345,
      "startedAt": "2026-02-10T10:00:00.000Z"
    }
  },
  "lastEnsure": "2026-02-10T10:00:00.000Z"
}
```

### Namespace Naming

Namespaces are named `{project-name}-{sanitized-branch-name}`. Branch names are sanitized to be DNS-compliant (lowercase, alphanumeric + hyphens, max 63 chars).

### File Watching

The watcher monitors paths specified in `services[].build.watchPaths`. Changes trigger:
1. Docker build
2. Load to kind
3. Helm upgrade

Rebuilds are debounced by 500ms to avoid excessive builds.

## Development

```bash
# Build TypeScript
npm run build

# Watch mode
npm run dev

# Type checking
npm run lint
```

## License

MIT
