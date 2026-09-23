/**
 * ENTITLEMENTS, as the server works them: what one workspace may use of the
 * enterprise features, and the two movements an operator makes.
 *
 * TWO THINGS HAVE TO HOLD for a workspace to use a feature. The deployment must
 * CARRY it — the enterprise bundle sat beside this tree at boot, which is what
 * `registerServerFeature` reports here — and the workspace must have been
 * GRANTED it. Neither alone is enough: a grant on an open-edition server names
 * routes nobody mounted, and a bundle beside the tree is a self-hosted
 * install's answer, not a hosted customer's.
 *
 * LOCAL MODE holds every feature the bundle carries. One developer on one
 * machine is the whole deployment: there is no operator to grant anything, no
 * console to grant it from, and nobody to bill — so asking a local server to be
 * granted its own features would be asking it to lock itself out.
 *
 * On a REVOKE the workspace's sources of that feature's kinds are PAUSED with
 * the reason, exactly as removing the connection they read through does. Their
 * documents stay, so a grant restored later is a Resume rather than a re-add.
 */

import {
  ENTERPRISE_FEATURES,
  ENTERPRISE_FEATURE_SOURCE_KINDS,
  editionOf,
  type Edition,
  type EnterpriseFeature,
} from '@truecourse/shared';
import { pauseContextSourcesOfKinds } from '@truecourse/core/lib/context-store';
import {
  grantEntitlement,
  readEntitlementWorkspaces,
  readWorkspaceEntitlements,
  revokeEntitlement,
  type EntitlementWorkspaceRecord,
} from '@truecourse/core/lib/entitlements-store';
import { isLocalMode } from '../mode.js';

/**
 * Whether the enterprise bundle registered itself at boot. Kept here rather
 * than read off the feature registry so nothing in the Context path has to
 * import that registry, which imports the Context path in turn.
 */
let editionPresent = false;

/** Set by `registerServerFeature` / `clearServerFeatures` — never by hand. */
export function setEnterpriseEditionPresent(present: boolean): void {
  editionPresent = present;
}

/** What this DEPLOYMENT can serve at all: the bundle's features, or nothing. */
export function servedEnterpriseFeatures(): readonly EnterpriseFeature[] {
  return editionPresent ? ENTERPRISE_FEATURES : [];
}

/**
 * What this WORKSPACE may use. The open edition answers none without reading
 * anything: there is nothing to grant, so there is nothing to look up.
 */
export async function workspaceEntitlements(
  workspaceOrgId: string,
): Promise<EnterpriseFeature[]> {
  const served = servedEnterpriseFeatures();
  if (served.length === 0) return [];
  if (isLocalMode()) return [...served];
  const held = new Set(await readWorkspaceEntitlements(workspaceOrgId));
  return served.filter((feature) => held.has(feature));
}

export async function isEntitled(
  workspaceOrgId: string,
  feature: EnterpriseFeature,
): Promise<boolean> {
  return (await workspaceEntitlements(workspaceOrgId)).includes(feature);
}

/** The one word for what a workspace holds, for the authenticated answer. */
export async function workspaceEdition(workspaceOrgId: string | null): Promise<Edition> {
  if (!workspaceOrgId) return 'community';
  return editionOf(await workspaceEntitlements(workspaceOrgId));
}

/** Every workspace, as the operator's console lists it. */
export function entitlementWorkspaces(): Promise<EntitlementWorkspaceRecord[]> {
  return readEntitlementWorkspaces();
}

/**
 * Hand a workspace one feature. Answers the GRANTS it holds afterwards, which
 * is what the operator manages — not the effective set, which also depends on
 * what the deployment carries.
 */
export async function grantWorkspaceFeature(input: {
  workspaceOrgId: string;
  feature: EnterpriseFeature;
  actorUserId: string;
  note?: string;
}): Promise<EnterpriseFeature[]> {
  await grantEntitlement({
    workspaceOrgId: input.workspaceOrgId,
    feature: input.feature,
    actorUserId: input.actorUserId,
    ...(input.note ? { note: input.note } : {}),
  });
  return readWorkspaceEntitlements(input.workspaceOrgId);
}

export interface EntitlementRevoke {
  /** Whether the workspace held it at all; false is a no-op, not a failure. */
  revoked: boolean;
  /** What the workspace holds now. */
  features: EnterpriseFeature[];
  /** The sources this revoke paused. */
  paused: string[];
}

/**
 * Take one feature back, and pause what read through it. The documents stay:
 * the workspace stopped being allowed to read, not to have read.
 */
export async function revokeWorkspaceFeature(input: {
  workspaceOrgId: string;
  feature: EnterpriseFeature;
}): Promise<EntitlementRevoke> {
  const revoked = await revokeEntitlement(input.workspaceOrgId, input.feature);
  const kinds = ENTERPRISE_FEATURE_SOURCE_KINDS[input.feature];
  const paused =
    kinds.length > 0
      ? await pauseContextSourcesOfKinds(
          input.workspaceOrgId,
          kinds,
          'This workspace is no longer entitled to the Connections that this source reads through.',
        )
      : [];
  return { revoked, features: await readWorkspaceEntitlements(input.workspaceOrgId), paused };
}
