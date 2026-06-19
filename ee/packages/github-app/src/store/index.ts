/**
 * Picks the GateStore adapter: the Postgres store on the shared ee-db when one
 * is provided (hosted), otherwise the file adapter (local/dev — unchanged file
 * model). The ee-db pool + migrations are owned by ee-server, not here.
 */

import { log } from '@truecourse/core/lib/logger';
import type { EeDb } from '@truecourse/ee-db';
import type { GateStore } from './types.js';
import { FileGateStore } from './file-store.js';
import { PostgresGateStore } from './pg-store.js';

export function selectGateStore(db: EeDb | null): GateStore {
  if (db) {
    log.info('[github-app] Using Postgres gate store (shared ee-db)');
    return new PostgresGateStore(db);
  }
  log.info('[github-app] Using file gate store (~/.truecourse/github-app)');
  return new FileGateStore();
}

export * from './types.js';
export { FileGateStore } from './file-store.js';
export { PostgresGateStore, type GateDb } from './pg-store.js';
