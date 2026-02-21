import { deleteNamespace } from './helpers/cluster.js';

export default async function globalTeardown() {
  // Clean up any leftover test namespaces
  // Don't delete the cluster — reuse across runs for speed
  const namespaces = [
    'smoke-tier1',
    'smoke-tier2',
    'smoke-tier3',
    'smoke-tier4',
    'smoke-tier5',
  ];

  for (const ns of namespaces) {
    try {
      deleteNamespace(ns);
    } catch {
      // Best effort
    }
  }
}
