/**
 * The enterprise edition's server features.
 *
 * The open server is the product; this package adds what the open edition does
 * not have. It is not a process of its own: the open server's entry looks for
 * this package beside its tree at boot and registers `eeServerFeatures` when it
 * is there, so the dependency still runs one way — this package names the open
 * server, and the open server names this package in exactly one file.
 *
 * Two features mount here: more than one workspace (`/api/auth/workspaces`) and
 * the document Connections (`/api/connections` over the workspace's one
 * Atlassian account, plus the Jira and Confluence context source drivers that
 * read through it). The third — the repository providers beyond the open
 * edition's, Azure DevOps today — adds no routes and registers in
 * `ee/packages/client` alone.
 */

export { eeServerFeatures } from './features.js';
export { createWorkspacesRouter, workspacesFeature } from './workspaces/index.js';
export {
  CONNECTIONS_PATH,
  ConnectionMissingError,
  ConnectionStore,
  confluenceConfig,
  connectionsFeature,
  createConfluenceDriver,
  createConnectionsRouter,
  createJiraDriver,
  jiraConfig,
  probeConfluence,
  probeJira,
  type AtlassianConnection,
  type ConfluenceDriverDeps,
  type ConnectionsRouterDeps,
  type JiraDriverDeps,
} from './connections/index.js';
