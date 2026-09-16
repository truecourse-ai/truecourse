/**
 * The enterprise edition's server features.
 *
 * The open server is the product; this package adds what the open edition does
 * not have. It is not a process of its own: the open server's entry looks for
 * this package beside its tree at boot and registers `eeServerFeatures` when it
 * is there, so the dependency still runs one way — this package names the open
 * server, and the open server names this package in exactly one file.
 *
 * The other two enterprise features are the client's — the document Connections
 * tab and the repository providers beyond the open edition's (Azure DevOps
 * today, listed as coming soon) add no routes, so they register in
 * `ee/packages/client` and nothing here mounts for them.
 */

export { eeServerFeatures } from './features.js';
export { createWorkspacesRouter, workspacesFeature } from './workspaces/index.js';
