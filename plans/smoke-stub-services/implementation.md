## Steps


## Testing
### Verification (not automated tests -- these are fixtures)

Each service should be manually verifiable:

```bash
# Test smoke-auth standalone
node test/smoke/fixtures/services/smoke-auth/server.js &
curl http://localhost:3000/health
curl -X POST http://localhost:3000/login
curl -X POST http://localhost:3000/verify -d '{"token": "..."}'
kill %1

# Test Docker build
docker build -t smoke-auth:latest test/smoke/fixtures/services/smoke-auth/

# Test Helm template rendering
helm template smoke test/smoke/fixtures/helm/grove-smoke/
```

Automated validation happens in the smoke test tiers (Tier 1 and Tier 2) which deploy these services and test them.
## Done-when


## Design
### Service: smoke-auth

**Location:** `test/smoke/fixtures/services/smoke-auth/`

**Files:** `server.js`, `Dockerfile`

```javascript
// server.js (~45 lines)
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret';

function sign(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token) {
  const [header, body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return sig === expected;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.url === '/login' && req.method === 'POST') {
    const token = sign({ user: 'smoke-user', iat: Date.now() });
    res.writeHead(200); res.end(JSON.stringify({ token }));
  } else if (req.url === '/verify' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { token } = JSON.parse(body || '{}');
      const valid = token && verify(token);
      res.writeHead(valid ? 200 : 401);
      res.end(JSON.stringify({ valid }));
    });
  } else {
    res.writeHead(404); res.end('not found');
  }
});
server.listen(PORT, () => console.log(`smoke-auth listening on ${PORT}`));
```

```dockerfile
# Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY server.js .
EXPOSE 3000
CMD ["node", "server.js"]
```

### Service: smoke-api

**Location:** `test/smoke/fixtures/services/smoke-api/`

```javascript
// server.js (~55 lines)
const http = require('http');

const PORT = process.env.PORT || 3001;
const AUTH_URL = process.env.AUTH_URL || 'http://localhost:3000';
const AGENT_URL = process.env.AGENT_URL || 'http://localhost:3002';

async function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end(JSON.stringify(body));
  });
}

async function verifyAuth(token) {
  try {
    const resp = await httpPost(`${AUTH_URL}/verify`, { token });
    return resp.status === 200;
  } catch {
    return false; // auth service down
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok' })); return;
  }
  // Auth-protected routes
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token || !(await verifyAuth(token))) {
    res.writeHead(401); res.end(JSON.stringify({ error: 'unauthorized' })); return;
  }
  if (req.url === '/data') {
    res.writeHead(200); res.end(JSON.stringify({ data: [1, 2, 3] }));
  } else if (req.url === '/agent/run') {
    try {
      const resp = await httpPost(`${AGENT_URL}/execute`, { task: 'test' });
      res.writeHead(resp.status); res.end(resp.body);
    } catch (e) {
      res.writeHead(502); res.end(JSON.stringify({ error: 'agent unavailable' }));
    }
  } else {
    res.writeHead(404); res.end('not found');
  }
});
server.listen(PORT, () => console.log(`smoke-api listening on ${PORT}`));
```

### Service: smoke-agent

**Location:** `test/smoke/fixtures/services/smoke-agent/`

```javascript
// server.js (~35 lines)
const http = require('http');

const PORT = process.env.PORT || 3002;
const MCP_URL = process.env.MCP_URL; // optional

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok' })); return;
  }
  if (req.url === '/execute' && req.method === 'POST') {
    let tools = null;
    if (MCP_URL) {
      try {
        const resp = await fetch(`${MCP_URL}/tools`);
        tools = await resp.json();
      } catch { /* MCP optional */ }
    }
    res.writeHead(200);
    res.end(JSON.stringify({ result: 'executed', tools }));
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(PORT, () => console.log(`smoke-agent listening on ${PORT}`));
```

### Service: smoke-mcp

**Location:** `test/smoke/fixtures/services/smoke-mcp/`

```javascript
// server.js (~20 lines)
const http = require('http');

const PORT = process.env.PORT || 3003;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok' }));
  } else if (req.url === '/tools') {
    res.writeHead(200);
    res.end(JSON.stringify({ tools: ['search', 'calculate', 'summarize'] }));
  } else {
    res.writeHead(404); res.end('not found');
  }
});
server.listen(PORT, () => console.log(`smoke-mcp listening on ${PORT}`));
```

### Helm Chart

**Location:** `test/smoke/fixtures/helm/grove-smoke/`

```
grove-smoke/
  Chart.yaml
  values.yaml
  templates/
    _helpers.tpl
    secret.yaml          # JWT_SECRET
    smoke-auth.yaml       # Deployment + Service
    smoke-api.yaml        # Deployment + Service
    smoke-agent.yaml      # Deployment + Service
    smoke-mcp.yaml        # Deployment + Service
```

**Chart.yaml:**
```yaml
apiVersion: v2
name: grove-smoke
version: 0.1.0
description: Smoke test services for Grove
```

**values.yaml:**
```yaml
auth:
  image: smoke-auth:latest
  port: 3000
  replicas: 1
api:
  image: smoke-api:latest
  port: 3001
  replicas: 1
agent:
  image: smoke-agent:latest
  port: 3002
  replicas: 1
mcp:
  image: smoke-mcp:latest
  port: 3003
  replicas: 1
jwtSecret: smoke-test-secret
imagePullPolicy: Never  # Images loaded via k3d/kind
```

**Template pattern (smoke-auth.yaml as example):**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: smoke-auth
spec:
  replicas: {{ .Values.auth.replicas }}
  selector:
    matchLabels:
      app: smoke-auth
  template:
    metadata:
      labels:
        app: smoke-auth
    spec:
      containers:
        - name: smoke-auth
          image: {{ .Values.auth.image }}
          imagePullPolicy: {{ .Values.imagePullPolicy }}
          ports:
            - containerPort: {{ .Values.auth.port }}
          env:
            - name: PORT
              value: {{ .Values.auth.port | quote }}
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: smoke-jwt
                  key: secret
          readinessProbe:
            httpGet:
              path: /health
              port: {{ .Values.auth.port }}
            initialDelaySeconds: 2
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: smoke-auth
spec:
  selector:
    app: smoke-auth
  ports:
    - port: {{ .Values.auth.port }}
      targetPort: {{ .Values.auth.port }}
```

**Inter-service wiring (smoke-api.yaml env section):**
```yaml
env:
  - name: PORT
    value: {{ .Values.api.port | quote }}
  - name: AUTH_URL
    value: "http://smoke-auth:{{ .Values.auth.port }}"
  - name: AGENT_URL
    value: "http://smoke-agent:{{ .Values.agent.port }}"
```

### Grove Config

**Location:** `test/smoke/fixtures/smoke.grove.yaml`

```yaml
project:
  name: grove-smoke
  cluster: grove-smoke
  clusterType: k3s

helm:
  chart: test/smoke/fixtures/helm/grove-smoke
  release: smoke
  valuesFiles:
    - test/smoke/fixtures/helm/grove-smoke/values.yaml

services:
  - name: smoke-auth
    build:
      image: smoke-auth:latest
      dockerfile: test/smoke/fixtures/services/smoke-auth/Dockerfile
    portForward:
      remotePort: 3000
    health:
      path: /health
      protocol: http
  - name: smoke-api
    build:
      image: smoke-api:latest
      dockerfile: test/smoke/fixtures/services/smoke-api/Dockerfile
    portForward:
      remotePort: 3001
    health:
      path: /health
      protocol: http
  - name: smoke-agent
    build:
      image: smoke-agent:latest
      dockerfile: test/smoke/fixtures/services/smoke-agent/Dockerfile
    portForward:
      remotePort: 3002
    health:
      path: /health
      protocol: http
  - name: smoke-mcp
    build:
      image: smoke-mcp:latest
      dockerfile: test/smoke/fixtures/services/smoke-mcp/Dockerfile
    portForward:
      remotePort: 3003
    health:
      path: /health
      protocol: http
```

## Files
| File | Action | Description |
|------|--------|-------------|
| `test/smoke/fixtures/services/smoke-auth/server.js` | Create | Auth service (~45 lines) |
| `test/smoke/fixtures/services/smoke-auth/Dockerfile` | Create | Node 22 alpine image |
| `test/smoke/fixtures/services/smoke-api/server.js` | Create | API service (~55 lines) |
| `test/smoke/fixtures/services/smoke-api/Dockerfile` | Create | Node 22 alpine image |
| `test/smoke/fixtures/services/smoke-agent/server.js` | Create | Agent service (~35 lines) |
| `test/smoke/fixtures/services/smoke-agent/Dockerfile` | Create | Node 22 alpine image |
| `test/smoke/fixtures/services/smoke-mcp/server.js` | Create | MCP service (~20 lines) |
| `test/smoke/fixtures/services/smoke-mcp/Dockerfile` | Create | Node 22 alpine image |
| `test/smoke/fixtures/helm/grove-smoke/Chart.yaml` | Create | Chart metadata |
| `test/smoke/fixtures/helm/grove-smoke/values.yaml` | Create | Default values |
| `test/smoke/fixtures/helm/grove-smoke/templates/_helpers.tpl` | Create | Template helpers |
| `test/smoke/fixtures/helm/grove-smoke/templates/secret.yaml` | Create | JWT secret |
| `test/smoke/fixtures/helm/grove-smoke/templates/smoke-auth.yaml` | Create | Auth Deployment + Service |
| `test/smoke/fixtures/helm/grove-smoke/templates/smoke-api.yaml` | Create | API Deployment + Service |
| `test/smoke/fixtures/helm/grove-smoke/templates/smoke-agent.yaml` | Create | Agent Deployment + Service |
| `test/smoke/fixtures/helm/grove-smoke/templates/smoke-mcp.yaml` | Create | MCP Deployment + Service |
| `test/smoke/fixtures/smoke.grove.yaml` | Create | Grove config for smoke topology |
