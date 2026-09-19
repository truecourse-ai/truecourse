/**
 * The edition seam on the server: routers this deployment mounts that the open
 * edition does not have.
 *
 * The open edition is the whole product minus three things — the document
 * Connections, repository providers beyond the open edition's (Azure DevOps
 * today, listed as coming soon), and more than one workspace — and those live
 * in `ee/`. The bundle exports its feature list, and the one process entry
 * registers it here at boot when the bundle sits beside this tree
 * (`edition-loader.ts`). So nothing else in this directory ever names `ee/`,
 * and the open edition is simply the one nobody registered into.
 *
 * A feature is built at boot, once, out of what the server already has: its
 * database, the key secrets are encrypted under, and the session tools a route
 * that moves between organizations mints cookies with.
 */

import type { Request, Router } from 'express';
import type { Db } from '@truecourse/db';
import type { ContextSourceKind, EnterpriseFeature } from '@truecourse/shared';
import type { ContextSourceDriver } from '@truecourse/core/services/context';
import type { WorkspaceSessionTools } from './auth/index.js';
import { setFeatureContextDrivers, type ContextChange } from './services/context.service.js';
import { setEnterpriseEditionPresent } from './services/entitlements.service.js';
import type { ServerAnalyticsEvent } from './observability/posthog.js';

/** What a feature is built from. */
export interface ServerFeatureContext {
  db: Db;
  /** The key every encrypted-at-rest secret is derived from. */
  masterSecret: string;
  /**
   * What a route that moves the session between organizations is built from.
   * Null in local mode: there is no identity provider and one workspace, so a
   * feature that needs one mounts nothing.
   */
  workspaceSession: WorkspaceSessionTools | null;
  /**
   * Report one product action, from the route where it became true. The event
   * names are the server's own catalogue (`observability/posthog.ts`), so a
   * feature can only send one that is in it.
   */
  capture(event: ServerAnalyticsEvent, req: Request, properties?: Record<string, unknown>): void;
  /** Tell a workspace its Context moved, so its open pages re-read. */
  contextChanged(org: string, change: ContextChange): Promise<void>;
  /**
   * Whether this workspace may use one of the enterprise features. Mounting a
   * router is a DEPLOYMENT's answer; this is the WORKSPACE's, and a feature
   * that serves more than one workspace has to ask it per request.
   */
  entitled(workspaceOrgId: string, feature: EnterpriseFeature): Promise<boolean>;
}

/**
 * One kind of context source a feature can sync. The driver is built PER
 * WORKSPACE, because a tool source reads the account that workspace connected,
 * and at call time, because a connection can be made or removed while the
 * server runs.
 */
export interface FeatureContextDriver {
  kind: ContextSourceKind;
  driver(workspaceOrgId: string): ContextSourceDriver;
}

export interface ServerRouterMount {
  /** Where it mounts, e.g. `/api/auth/workspaces`. */
  path: string;
  router: Router;
  /**
   * Mounted ABOVE the auth gate, for a router that authenticates itself.
   * Everything else sits behind the gate with the session already resolved.
   */
  public?: boolean;
}

export interface ServerFeature {
  /** What it is, for the boot log. */
  name: string;
  /**
   * The grant a workspace must hold to use it. What this feature contributes —
   * its routers, the context kinds it drives — is the workspace's only once it
   * has been granted this.
   */
  entitlement?: EnterpriseFeature;
  /**
   * True of the feature that lets one person be in more than one workspace.
   * Without it a session is in one, and an invite to another is refused
   * rather than moving the session somewhere it cannot come back from.
   */
  manyWorkspaces?: boolean;
  mount(context: ServerFeatureContext): ServerRouterMount[];
  /**
   * The context source kinds this feature drives. They are merged over the open
   * edition's own drivers, which is what makes a tool source addable, syncable
   * and swept exactly as a site is.
   */
  contextDrivers?(context: ServerFeatureContext): FeatureContextDriver[];
}

const features: ServerFeature[] = [];

export function registerServerFeature(feature: ServerFeature): void {
  features.push(feature);
  // One registration is the whole answer to whether this deployment carries the
  // enterprise edition, so the entitlements service learns it here rather than
  // reading a registry it must not depend on.
  setEnterpriseEditionPresent(true);
}

export function registeredServerFeatures(): readonly ServerFeature[] {
  return features;
}

/** Test seam: a registration must not outlive the test that made it. */
export function clearServerFeatures(): void {
  features.length = 0;
  setFeatureContextDrivers([]);
  setEnterpriseEditionPresent(false);
}
