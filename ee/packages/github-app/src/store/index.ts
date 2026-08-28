/**
 * Picks the GateStore adapter: the Postgres store on the shared db when one
 * is provided (hosted), otherwise the file adapter (local/dev — unchanged file
 * model). The db pool + migrations are owned by ee-server, not here.
 */

import { log } from '@truecourse/core/lib/logger';
import type { Db } from '@truecourse/db';
import { PostgresGateStore, type GateStore } from '@truecourse/github-app';
import { FileGateStore } from './file-store.js';

export function selectGateStore(db: Db | null): GateStore {
  if (db) {
    log.info('[github-app] Using Postgres gate store (shared db)');
    return new PostgresGateStore(db);
  }
  log.info('[github-app] Using file gate store (~/.truecourse/github-app)');
  return new FileGateStore();
}

export type {
  GateStore,
  InstallationRecord,
  RepoLinkRecord,
  BaselineRecord,
  PrState,
  PrRecord,
  GateRunRecord,
} from '@truecourse/github-app';
export { PostgresGateStore, type GateDb } from '@truecourse/github-app';
export { FileGateStore } from './file-store.js';
export {
  selectOperatorRepoEnumeration,
  type OperatorRepoEnumeration,
  type OperatorRepoRef,
} from './operator-repos.js';
