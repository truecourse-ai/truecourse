/**
 * The ENTITLEMENTS store — which enterprise features a workspace may use.
 *
 * One seam, ONE implementation: the Postgres store (`@truecourse/data-store`),
 * installed at boot. Nothing is installed by default, and a read that arrives
 * before boot says so rather than inventing a workspace with everything or a
 * workspace with nothing.
 *
 * A grant is PER FEATURE, never one enterprise flag: the three are independent,
 * and a workspace that paid for the document connections has not thereby asked
 * for more than one workspace. A row exists exactly while the grant does, so
 * revoking is deleting it and the history of the decision is the operator's,
 * not this table's.
 */

import type { EnterpriseFeature } from '@truecourse/shared';

/** One grant, exactly as the store holds it. */
export interface EntitlementRecord {
  workspaceOrgId: string;
  feature: EnterpriseFeature;
  grantedAt: string;
  /** The operator who granted it. */
  grantedBy: string | null;
  note: string | null;
}

/** What an operator hands a workspace. */
export interface EntitlementGrant {
  workspaceOrgId: string;
  feature: EnterpriseFeature;
  actorUserId: string;
  note?: string;
}

/** One workspace as the operator's console lists it. */
export interface EntitlementWorkspaceRecord {
  workspaceOrgId: string;
  features: EnterpriseFeature[];
}

export interface EntitlementsStore {
  /** The features this workspace holds; one that was never granted holds none. */
  of(workspaceOrgId: string): Promise<EnterpriseFeature[]>;
  /**
   * Every workspace the console lists — those with a grant, plus those that
   * exist at all, so one that has never been granted is still there to grant to.
   */
  workspaces(): Promise<EntitlementWorkspaceRecord[]>;
  /** Hand one over. Granting what a workspace already holds re-stamps the row. */
  grant(grant: EntitlementGrant): Promise<EntitlementRecord>;
  /** Take one back; false when the workspace did not hold it. */
  revoke(workspaceOrgId: string, feature: EnterpriseFeature): Promise<boolean>;
}

/** Reaching the store before boot installed it is a bug — say so, don't invent. */
const NOT_INSTALLED =
  'No entitlements store installed (boot did not run installDbStores).';

class UninstalledEntitlementsStore implements EntitlementsStore {
  private fail(): never {
    throw new Error(NOT_INSTALLED);
  }
  of(): Promise<EnterpriseFeature[]> {
    this.fail();
  }
  workspaces(): Promise<EntitlementWorkspaceRecord[]> {
    this.fail();
  }
  grant(): Promise<EntitlementRecord> {
    this.fail();
  }
  revoke(): Promise<boolean> {
    this.fail();
  }
}

const unavailable = new UninstalledEntitlementsStore();
let active: EntitlementsStore = unavailable;

export function setEntitlementsStore(store: EntitlementsStore): void {
  active = store;
}

export function resetEntitlementsStore(): void {
  active = unavailable;
}

/** Whether boot installed the entitlements store. */
export function entitlementsStoreInstalled(): boolean {
  return active !== unavailable;
}

export const readWorkspaceEntitlements = (
  workspaceOrgId: string,
): Promise<EnterpriseFeature[]> => active.of(workspaceOrgId);

export const readEntitlementWorkspaces = (): Promise<EntitlementWorkspaceRecord[]> =>
  active.workspaces();

export const grantEntitlement = (grant: EntitlementGrant): Promise<EntitlementRecord> =>
  active.grant(grant);

export const revokeEntitlement = (
  workspaceOrgId: string,
  feature: EnterpriseFeature,
): Promise<boolean> => active.revoke(workspaceOrgId, feature);
