/**
 * The document CONNECTIONS feature: the account a workspace connects once per
 * tool, and the context source drivers that read through it.
 *
 * A connection and a source are two things. The connection is the account —
 * made in Settings › Connections, one row per tool, its token encrypted at rest
 * — and it is this feature's routes. A source is what that account READS (a
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

  mount(context) {
    const store = new ConnectionStore(context.db, context.masterSecret);
    return [
      {
        path: CONNECTIONS_PATH,
        router: createConnectionsRouter({
          store,
          probe: (provider, connection) =>
            provider === 'jira' ? probeJira(connection) : probeConfluence(connection),
          context,
        }),
      },
    ];
  },

  contextDrivers(context): FeatureContextDriver[] {
    const store = new ConnectionStore(context.db, context.masterSecret);
    return [
      {
        kind: 'jira',
        driver: (org) =>
          createJiraDriver({ connection: () => store.requireConnection(org, 'jira') }),
      },
      {
        kind: 'confluence',
        driver: (org) =>
          createConfluenceDriver({
            connection: () => store.requireConnection(org, 'confluence'),
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
