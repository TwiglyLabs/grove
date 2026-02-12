import type { EnvironmentState } from './state.js';

/**
 * Resolve template variables in env var values.
 *
 * Supported patterns:
 *   {{ports.SERVICE}}  → resolved port number as string
 *   {{urls.SERVICE}}   → resolved URL string
 *
 * Unresolved templates are left as-is.
 */
export function resolveTemplates(
  env: Record<string, string>,
  state: EnvironmentState
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\{\{(ports|urls)\.([^}]+)\}\}/g, (_match, type, name) => {
      if (type === 'ports') {
        const port = state.ports[name];
        return port !== undefined ? String(port) : _match;
      }
      if (type === 'urls') {
        const url = state.urls[name];
        return url !== undefined ? url : _match;
      }
      return _match;
    });
  }

  return resolved;
}
