import { join } from 'node:path';
import { checkSmokePrerequisites, formatMissingSmokePrerequisites } from './helpers/prerequisites.js';
import { buildSmokeImages, loadSmokeImages } from './helpers/images.js';
import { ensureSmokeCluster } from './helpers/cluster.js';

const CLUSTER_NAME = 'grove-smoke';
const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');

export default async function globalSetup() {
  // Check prerequisites
  const prereqs = checkSmokePrerequisites();
  if (!prereqs.docker || !prereqs.kubectl || !prereqs.helm || !prereqs.k3d) {
    const msg = formatMissingSmokePrerequisites();
    console.error(msg);
    throw new Error('Smoke test prerequisites not met');
  }

  // Ensure cluster exists
  ensureSmokeCluster(CLUSTER_NAME);

  // Build and load images
  buildSmokeImages(FIXTURES_DIR);
  loadSmokeImages(CLUSTER_NAME);

  // Export for tests
  process.env.SMOKE_CLUSTER_NAME = CLUSTER_NAME;
  process.env.SMOKE_FIXTURES_DIR = FIXTURES_DIR;
}
