# Configuration Reference

Grove reads a `.grove.yaml` file from the root of your git repository. The file is validated at startup using Zod schemas — invalid config produces a clear error with the offending field path.

## Minimal Example

A backend service with a single HTTP service:

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
```

## Full Example

```yaml
project:
  name: myapp
  cluster: twiglylabs-local
  clusterType: kind

helm:
  chart: deploy/helm/myapp
  release: myapp
  valuesFiles:
    - deploy/helm/values.yaml
    - deploy/helm/values.local.yaml
  secretsTemplate: deploy/helm/secrets.yaml.tmpl
  wait: true

services:
  - name: api
    build:
      image: myapp/api:local
      dockerfile: services/api/Dockerfile
      args:
        NODE_ENV: development
      watchPaths:
        - services/api/src
        - services/api/package.json
    portForward:
      remotePort: 8080
      hostIp: 127.0.0.1
    health:
      path: /health
      protocol: http

  - name: worker
    build:
      image: myapp/worker:local
      dockerfile: services/worker/Dockerfile
      watchPaths:
        - services/worker/src

frontends:
  - name: webapp
    command: npm run dev
    cwd: frontends/webapp
    env:
      VITE_API_URL: http://localhost:8080
    health:
      path: /
      protocol: http

bootstrap:
  - name: Copy env file
    check:
      type: fileExists
      path: .env.local
    fix:
      type: copyFrom
      source: .env.example
      dest: .env.local

  - name: Install dependencies
    check:
      type: commandSucceeds
      command: node -e "require('./node_modules/.bin/tsc')"
    fix:
      type: run
      command: npm install

testing:
  mobile:
    runner: maestro
    basePath: e2e/mobile
    suites:
      - name: smoke
        paths:
          - e2e/mobile/smoke
    envVars:
      MAESTRO_DRIVER_STARTUP_TIMEOUT: "30000"
  webapp:
    runner: playwright
    cwd: frontends/webapp
    envVars:
      BASE_URL: http://localhost:3000
  api:
    runner: jest
    cwd: services/api
  historyDir: .grove/test-history
  historyLimit: 10
  defaultTimeout: 300000

simulator:
  platform: ios
  bundleId: com.example.myapp
  appName: MyApp
  simulatorPrefix: Grove
  baseDevice:
    - iPhone 15 Pro
  deepLinkScheme: myapp
  metroFrontend: mobile

utilities:
  shellTargets:
    - name: api
      podSelector: app=myapp-api
      shell: /bin/sh
    - name: worker
      podSelector: app=myapp-worker
  reloadTargets:
    - api
    - worker

workspace:
  repos:
    - path: ../shared
      remote: origin
    - path: ../infra
  setup:
    - npm install
    - npm run build
  hooks:
    postCreate: npm run setup
    preUp: npm run codegen
    postUp: echo "Environment ready"

hooks:
  pre-deploy:
    - name: Run migrations
      command: kubectl exec -n $NAMESPACE deploy/api -- npm run migrate
```

---

## Field Reference

### `project`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Project name, shown in the terminal banner |
| `cluster` | string | no | `twiglylabs-local` | Kind/k3s cluster name |
| `clusterType` | `kind` \| `k3s` | no | `kind` | Cluster provider |

### `helm`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `chart` | string | yes | — | Path to the Helm chart directory, relative to repo root |
| `release` | string | yes | — | Helm release name |
| `valuesFiles` | string[] | yes | — | Ordered list of values files, relative to repo root |
| `secretsTemplate` | string | no | — | Path to a secrets template file |
| `wait` | boolean | no | — | If true, `helm upgrade --wait` is passed |

### `services[]`

Each entry in the `services` array defines a Kubernetes-deployed service.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Service name, used as an identifier in all CLI commands |
| `build` | ServiceBuild | no | Docker build configuration |
| `portForward` | PortForward | no | Port forwarding from the pod to localhost |
| `health` | HealthCheck | no | Health check configuration |

#### `services[].build`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | string | yes | Docker image tag (e.g., `myapp/api:local`) |
| `dockerfile` | string | yes | Path to Dockerfile, relative to repo root |
| `args` | Record\<string, string\> | no | Docker build arguments |
| `watchPaths` | string[] | no | Paths to watch for changes (`grove watch`) |

#### `services[].portForward`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `remotePort` | integer | yes | — | Port the container listens on |
| `hostIp` | string (IPv4) | no | `127.0.0.1` | Local interface to bind |

The local port is allocated dynamically per worktree from a port block. Use `grove status` to see the assigned port.

#### `services[].health` / `frontends[].health`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `path` | string | no | — | HTTP path to check |
| `protocol` | `http` \| `tcp` | no | `http` | Health check protocol |

### `frontends[]`

Each entry defines a local frontend dev server process (e.g., Vite, Next.js).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Frontend name |
| `command` | string | yes | Shell command to start the dev server |
| `cwd` | string | yes | Working directory for the command, relative to repo root |
| `env` | Record\<string, string\> | no | Environment variables injected into the process |
| `health` | HealthCheck | no | Health check configuration (see above) |

### `bootstrap[]`

Bootstrap steps run during `grove up` to ensure the local environment is ready before deployment. Each step is only run if its `check` fails.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Human-readable step name |
| `check` | BootstrapCheck | yes | Condition that must pass to skip this step |
| `fix` | BootstrapFix | yes | Action to take if the check fails |

#### `bootstrap[].check`

| Type | Fields | Description |
|------|--------|-------------|
| `fileExists` | `path: string` | Passes if the file exists |
| `dirExists` | `path: string` | Passes if the directory exists |
| `commandSucceeds` | `command: string` | Passes if the command exits 0 |

#### `bootstrap[].fix`

| Type | Fields | Description |
|------|--------|-------------|
| `copyFrom` | `source: string`, `dest: string` | Copy a file |
| `run` | `command: string` | Run a shell command |

### `testing`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mobile` | MobileTesting | no | — | Mobile test runner config |
| `webapp` | PlatformTesting | no | — | Web app test runner config |
| `api` | PlatformTesting | no | — | API test runner config |
| `historyDir` | string | no | `.grove/test-history` | Directory for test result history |
| `historyLimit` | integer | no | `10` | Number of historical results to keep |
| `defaultTimeout` | integer (ms) | no | `300000` | Default test timeout |

#### `testing.mobile`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `runner` | string | no | `maestro` | Test runner binary |
| `basePath` | string | yes | — | Base directory for test files |
| `suites` | TestSuite[] | no | — | Named test suites with file paths |
| `envVars` | Record\<string, string\> | no | — | Environment variables for the runner |

#### `testing.webapp` / `testing.api`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `runner` | string | yes | Test runner command (e.g., `playwright`, `jest`) |
| `cwd` | string | yes | Working directory for the test command |
| `envVars` | Record\<string, string\> | no | Environment variables for the runner |

### `simulator`

iOS simulator configuration. Required when running mobile tests.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | `ios` | yes | Simulator platform |
| `bundleId` | string | yes | App bundle identifier |
| `appName` | string | yes | App display name |
| `simulatorPrefix` | string | yes | Prefix for created simulator names |
| `baseDevice` | string[] | yes | List of device models to use |
| `deepLinkScheme` | string | yes | Deep link URL scheme |
| `metroFrontend` | string | yes | Name of the Metro frontend entry in `frontends[]` |

### `utilities`

| Field | Type | Description |
|-------|------|-------------|
| `shellTargets` | ShellTarget[] | Named shell targets for `grove shell` |
| `reloadTargets` | string[] | Service names that support `grove reload` |

#### `utilities.shellTargets[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Target name |
| `podSelector` | string | no | kubectl label selector (e.g., `app=myapp-api`) |
| `shell` | string | no | Shell binary path (default: `/bin/sh`) |

### `workspace`

Declares a grouped workspace: a parent repo plus one or more child repos that are co-located and share a branch when `grove workspace create` is run.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repos` | WorkspaceRepo[] | yes | Child repos to include |
| `setup` | string[] | no | Commands to run after workspace creation |
| `hooks` | Hooks | no | Lifecycle hooks |

#### `workspace.repos[]`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Relative path from the parent repo to the child repo |
| `remote` | string | no | Git remote name (default: `origin`) |

#### `workspace.hooks`

| Field | Type | Description |
|-------|------|-------------|
| `postCreate` | string | Shell command run after workspace creation |
| `preUp` | string | Shell command run before `grove up` |
| `postUp` | string | Shell command run after `grove up` completes |

### `hooks`

Environment-level hooks, distinct from workspace hooks.

| Section | Field | Description |
|---------|-------|-------------|
| `pre-deploy` | `name`, `command` | Steps run before Helm deployment |

```yaml
hooks:
  pre-deploy:
    - name: Run migrations
      command: kubectl exec -n $NAMESPACE deploy/api -- npm run migrate
```
