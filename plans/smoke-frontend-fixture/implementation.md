## Steps


## Testing
### Manual verification

```bash
cd test/smoke/fixtures/frontend
npm install
GROVE_API_PORT=3001 PORT=5555 npm run dev
# In another terminal: curl http://localhost:5555/ should return HTML
```

Automated testing happens in Tier 3 smoke tests, which deploy the full stack and test the proxy behavior via HTTP fetch.
## Done-when


## Design
### File structure

```
test/smoke/fixtures/frontend/
  package.json
  vite.config.js
  index.html
  src/
    main.jsx
    App.jsx
```

### `package.json`

```json
{
  "name": "grove-smoke-frontend",
  "private": true,
  "scripts": {
    "dev": "vite"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0"
  }
}
```

### `vite.config.js`

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // PORT is injected by Grove's GenericDevServer
    port: parseInt(process.env.PORT || '5173'),
    strictPort: true,
    proxy: {
      '/api': {
        // GROVE_API_PORT is injected via .grove.yaml env template
        target: `http://127.0.0.1:${process.env.GROVE_API_PORT || '3001'}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
```

### `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>Grove Smoke</title></head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

### `src/main.jsx`

```jsx
import { createRoot } from 'react-dom/client';
import App from './App';
createRoot(document.getElementById('root')).render(<App />);
```

### `src/App.jsx`

```jsx
import { useState } from 'react';

export default function App() {
  const [token, setToken] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function login() {
    try {
      const res = await fetch('/api/login', { method: 'POST' });
      const json = await res.json();
      setToken(json.token);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function fetchData() {
    try {
      const res = await fetch('/api/data', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1>Grove Smoke Frontend</h1>
      {!token ? (
        <button onClick={login} id="login-btn">Login</button>
      ) : (
        <div>
          <p id="auth-status">Authenticated</p>
          <button onClick={fetchData} id="fetch-btn">Fetch Data</button>
          {data && <pre id="data-output">{JSON.stringify(data, null, 2)}</pre>}
        </div>
      )}
      {error && <p id="error-output" style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
```

### Grove config addition to `smoke.grove.yaml`

```yaml
frontends:
  - name: smoke-frontend
    command: npm run dev
    cwd: test/smoke/fixtures/frontend
    env:
      GROVE_API_PORT: "{{ports.smoke-api}}"
    health:
      path: /
      protocol: http
```

### How it works with Grove

1. Grove's `GenericDevServer` spawns `npm run dev` in the frontend's `cwd`
2. `PORT` env var is set to the allocated port (e.g., 10004)
3. `GROVE_API_PORT` is resolved via template to the smoke-api port (e.g., 10001)
4. Vite starts on the allocated port with proxy configured
5. Requests to `http://localhost:10004/api/login` are proxied to `http://127.0.0.1:10001/login`
6. Grove health-checks `http://127.0.0.1:10004/` and sees the HTML page

## Files
| File | Action | Description |
|------|--------|-------------|
| `test/smoke/fixtures/frontend/package.json` | Create | Vite + React dependencies |
| `test/smoke/fixtures/frontend/vite.config.js` | Create | Dev server with API proxy |
| `test/smoke/fixtures/frontend/index.html` | Create | HTML entry point |
| `test/smoke/fixtures/frontend/src/main.jsx` | Create | React mount |
| `test/smoke/fixtures/frontend/src/App.jsx` | Create | Login + data page |
| `test/smoke/fixtures/smoke.grove.yaml` | Modify | Add frontends section |
