/**
 * The installed connectors. Adding a tool = adding an entry here; nothing else
 * (consolidator, sync engine, routes) changes.
 */

import type { ConnectorKind, KnowledgeConnector } from './types.js';
import { confluenceConnector } from './confluence.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CONNECTORS: Partial<Record<ConnectorKind, KnowledgeConnector<any>>> = {
  confluence: confluenceConnector,
};
