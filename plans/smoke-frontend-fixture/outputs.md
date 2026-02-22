
## Test fixtures
`test/smoke/fixtures/frontend/` — minimal Vite + React application:
- `vite.config.ts` — proxy config routing `/api` to `http://localhost:${GROVE_API_PORT}` at build/dev time
- `src/pages/Login.tsx` — login page component that POSTs credentials to the proxied API
- `src/pages/Data.tsx` — authenticated data page that fetches from the proxied API
- `package.json` — minimal deps: react, react-dom, vite

## Grove config
`test/smoke/fixtures/smoke.grove.yaml` gains a frontend entry:
```yaml
frontends:
  - name: smoke-frontend
    path: test/smoke/fixtures/frontend
    port: 5173
    proxy:
      /api: smoke-api
```
This config is consumed by the `smoke-tier3-frontend` smoke test tier.

## Pattern established
Frontend fixture pattern: a self-contained Vite app with environment-variable-driven proxy config, making it buildable and testable both inside and outside the cluster. `GROVE_API_PORT` is injected by the smoke test harness at runtime, enabling the tier-3 tests to validate grove's frontend proxy wiring end-to-end.
