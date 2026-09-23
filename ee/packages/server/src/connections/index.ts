/**
 * The document CONNECTIONS feature: the account a workspace connects, and the
 * context source drivers that read through it.
 *
 * A connection and a source are two things. The connection is the ACCOUNT —
 * made in Settings › Connections, its token encrypted at rest — and it is this
 * feature's routes. One Atlassian site is one account: a single row, a single
 * token, and the two kinds it serves. A source is what that account READS (a
 * Jira project, a Confluence space), added in Context like any other source;
 * there can be several per connection, and they are ordinary `context_sources`
 * rows that the open edition's routes, sync job and sweep handle unchanged. All
 * this feature adds there is the DRIVER for the two kinds, built per workspace
 * so it reads the account that workspace connected.
 */

import type { FeatureContextDriver, ServerFeature } from '@truecourse/dashboard-server';
import { createConfluenceDriver, probeConfluence } from './confluence-driver.js';
import { createJiraDriver, probeJira } from './jira-driver.js';
import { createConnectionsRouter } from './routes.js';
import { ConnectionStore } from './store.js';

export const CONNECTIONS_PATH = '/api/connections';

export const connectionsFeature: ServerFeature = {
  name: 'document connections',
  // Which workspaces may use it is an operator's grant, not this deployment's
  // answer: the routes refuse an ungranted workspace and its kinds are never
  // offered in Add context.
  entitlement: 'connections',

  mount(context) {
    const store = new ConnectionStore(context.db, context.masterSecret);
    return [
      {
        path: CONNECTIONS_PATH,
        router: createConnectionsRouter({
          store,
          probe: (kind, connection) =>
            kind === 'jira'
              ? probeJira(connection, { publicOnly: true })
              : probeConfluence(connection, { publicOnly: true }),
          context,
        }),
      },
    ];
  },

  // Every call to Atlassian goes to a site URL a member typed, so all of them
  // run under the public-only network policy site sources have.
  contextDrivers(context): FeatureContextDriver[] {
    const store = new ConnectionStore(context.db, context.masterSecret);
    return [
      {
        kind: 'jira',
        driver: (org) =>
          createJiraDriver({
            connection: () => store.requireConnection(org, 'atlassian'),
            publicOnly: true,
          }),
      },
      {
        kind: 'confluence',
        driver: (org) =>
          createConfluenceDriver({
            connection: () => store.requireConnection(org, 'atlassian'),
            publicOnly: true,
          }),
      },
    ];
  },
};

export { ConnectionStore, ConnectionMissingError, type AtlassianConnection } from './store.js';
export { createConnectionsRouter, type ConnectionsRouterDeps } from './routes.js';
export { createJiraDriver, jiraConfig, probeJira, type JiraDriverDeps } from './jira-driver.js';
export {
  confluenceConfig,
  createConfluenceDriver,
  probeConfluence,
  type ConfluenceDriverDeps,
} from './confluence-driver.js';
