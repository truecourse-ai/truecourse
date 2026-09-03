/**
 * Operator/boot-only cross-tenant repo enumeration.
 *
 * SECURITY: this deliberately lives OUTSIDE {@link GateStore}. Every route
 * handler is handed a `GateStore`, whose reads are workspace-scoped
 * (`listReposForWorkspace`) — so a handler structurally cannot reach a
 * cross-tenant enumeration. This interface enumerates connected+enabled repos
 * across ALL workspaces and MUST only be used by boot-time operator machinery
 * (the deploy-time guard backfill). Never inject it into a request path.
 *
 * It exists ONLY as a Postgres query behind the hosted `Db` — there is no file
 * adapter, because the only caller (the deploy backfill) runs solely in the hosted
 * server where the db is always present. So the cross-tenant surface has exactly
 * one implementation, gated on holding the shared db handle; a caller with no db
 * cannot enumerate at all.
 *
 * Each returned repo still carries its own `workspaceOrgId`, so any job the
 * caller enqueues stays stamped to that repo's tenant (jobs-UI visibility stays
 * per-tenant, decision 5).
 */

import { eq } from 'drizzle-orm';
import type { Db } from '@truecourse/db';
import { ghRepos } from '@truecourse/db';

/** The minimal projection the backfill needs to enqueue per-repo guard jobs. */
export interface OperatorRepoRef {
  repoFullName: string;
  installationId: number;
  defaultBranch: string;
  workspaceOrgId: string;
}

/** Operator/boot-only enumeration. Never hand this to a route handler. */
export interface OperatorRepoEnumeration {
  /** Connected + enabled repos across EVERY workspace. */
  listAllRepos(): Promise<OperatorRepoRef[]>;
}

class PostgresOperatorRepoEnumeration implements OperatorRepoEnumeration {
  constructor(private readonly db: Db) {}

  async listAllRepos(): Promise<OperatorRepoRef[]> {
    const rows = await this.db
      .select({
        repoFullName: ghRepos.repoFullName,
        installationId: ghRepos.installationId,
        defaultBranch: ghRepos.defaultBranch,
        workspaceOrgId: ghRepos.workspaceOrgId,
      })
      .from(ghRepos)
      .where(eq(ghRepos.enabled, true))
      .orderBy(ghRepos.repoFullName);
    return rows;
  }
}

/**
 * The operator enumeration over the hosted gate store. Boot-only — see the module
 * doc. Takes the shared db non-nullably: the cross-tenant surface only ever runs
 * hosted, so there is no local/file fallback to select between.
 */
export function selectOperatorRepoEnumeration(db: Db): OperatorRepoEnumeration {
  return new PostgresOperatorRepoEnumeration(db);
}
