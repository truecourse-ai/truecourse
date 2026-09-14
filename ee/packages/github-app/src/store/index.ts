/**
 * The GateStore adapter: the Postgres store on the shared db. The pool and the
 * migrations are owned by ee-server, not here.
 */

import type { Db } from '@truecourse/db';
import { PostgresGateStore, type GateStore } from '@truecourse/github-app';

export function selectGateStore(db: Db): GateStore {
  return new PostgresGateStore(db);
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
export {
  selectOperatorRepoEnumeration,
  type OperatorRepoEnumeration,
  type OperatorRepoRef,
} from './operator-repos.js';
