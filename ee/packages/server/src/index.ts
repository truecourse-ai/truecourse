/**
 * The enterprise edition's server features.
 *
 * The open server is the product; this package adds what the open edition does
 * not have, by registering into the open server's registry. The dependency runs
 * one way, from here inward, which is why nothing in the open tree ever reaches
 * for `ee/`.
 *
 * The other two enterprise features are the client's — the document Connections
 * tab and the repository providers beyond the open edition's (Azure DevOps
 * today, listed as coming soon) add no routes, so they register in
 * `ee/packages/client` and nothing here mounts for them.
 */

import { registerServerFeature } from '@truecourse/dashboard-server';
import { eeServerFeatures } from './features.js';

export { eeServerFeatures } from './features.js';
export { createWorkspacesRouter, workspacesFeature } from './workspaces/index.js';

export function registerEeServerFeatures(): void {
  for (const feature of eeServerFeatures) registerServerFeature(feature);
}
