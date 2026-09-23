/**
 * The hosted half of core's `EntitlementsStore`: which enterprise features a
 * workspace may use, over `workspace_entitlements`.
 *
 * A row IS the grant — revoking deletes it, and granting again re-stamps who
 * granted it and when. A row naming a feature this build does not know is
 * ignored on the way out rather than widening the vocabulary: the table holds
 * text, and only `@truecourse/shared` says what a feature is.
 */

import { and, eq } from 'drizzle-orm';
import {
  llmProviderConfig,
  repositories,
  workspaceEntitlements,
  workspaceProfiles,
  type Db,
} from '@truecourse/db';
import { ENTERPRISE_FEATURES, type EnterpriseFeature } from '@truecourse/shared';
import type {
  EntitlementGrant,
  EntitlementRecord,
  EntitlementWorkspaceRecord,
  EntitlementsStore,
} from '@truecourse/core/lib/entitlements-store';
import { iso } from './iso.js';

type Row = typeof workspaceEntitlements.$inferSelect;

function toRecord(row: Row): EntitlementRecord {
  return {
    workspaceOrgId: row.workspaceOrgId,
    feature: row.feature as EnterpriseFeature,
    grantedAt: iso(row.grantedAt),
    grantedBy: row.grantedBy,
    note: row.note,
  };
}

/** The features a set of rows names, in the vocabulary's own order. */
function featuresOf(rows: readonly Row[]): EnterpriseFeature[] {
  const held = new Set(rows.map((row) => row.feature));
  return ENTERPRISE_FEATURES.filter((feature) => held.has(feature));
}

export class PgEntitlementsStore implements EntitlementsStore {
  constructor(private readonly db: Db) {}

  async of(workspaceOrgId: string): Promise<EnterpriseFeature[]> {
    const rows = await this.db
      .select()
      .from(workspaceEntitlements)
      .where(eq(workspaceEntitlements.workspaceOrgId, workspaceOrgId));
    return featuresOf(rows);
  }

  /**
   * Every workspace the console lists: those with a grant, plus those that
   * exist at all (a stated description, a saved provider, a connected
   * repository), so a workspace that has never been granted anything is still
   * there to grant to. The description is stated at creation, so it is what
   * lists a new workspace before it has connected anything.
   */
  async workspaces(): Promise<EntitlementWorkspaceRecord[]> {
    const granted = await this.db.select().from(workspaceEntitlements);
    const known = new Set<string>(granted.map((row) => row.workspaceOrgId));
    for (const row of await this.db
      .select({ org: workspaceProfiles.workspaceOrgId })
      .from(workspaceProfiles)) {
      known.add(row.org);
    }
    for (const row of await this.db
      .selectDistinct({ org: llmProviderConfig.orgId })
      .from(llmProviderConfig)) {
      known.add(row.org);
    }
    for (const row of await this.db
      .selectDistinct({ org: repositories.workspaceOrgId })
      .from(repositories)) {
      known.add(row.org);
    }
    return [...known].sort().map((org) => ({
      workspaceOrgId: org,
      features: featuresOf(granted.filter((row) => row.workspaceOrgId === org)),
    }));
  }

  async grant(grant: EntitlementGrant): Promise<EntitlementRecord> {
    const now = new Date().toISOString();
    const values = {
      workspaceOrgId: grant.workspaceOrgId,
      feature: grant.feature,
      grantedAt: now,
      grantedBy: grant.actorUserId,
      note: grant.note ?? null,
    };
    const [row] = await this.db
      .insert(workspaceEntitlements)
      .values(values)
      .onConflictDoUpdate({
        target: [workspaceEntitlements.workspaceOrgId, workspaceEntitlements.feature],
        set: { grantedAt: now, grantedBy: values.grantedBy, note: values.note },
      })
      .returning();
    return toRecord(row!);
  }

  async revoke(workspaceOrgId: string, feature: EnterpriseFeature): Promise<boolean> {
    const gone = await this.db
      .delete(workspaceEntitlements)
      .where(
        and(
          eq(workspaceEntitlements.workspaceOrgId, workspaceOrgId),
          eq(workspaceEntitlements.feature, feature),
        ),
      )
      .returning();
    return gone.length > 0;
  }
}
