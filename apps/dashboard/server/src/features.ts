/**
 * The edition seam on the server: routers this deployment mounts that the open
 * edition does not have.
 *
 * The open edition is the whole product minus three things — the document
 * Connections, repository providers beyond GitHub and GitLab, and more than one
 * workspace — and those live in `ee/`. Rather than the open server reaching for
 * them, the ENTERPRISE BUNDLE IS THE OUTER LAYER: its process entry registers
 * its features here and then calls {@link startServer}. So nothing in this
 * directory ever imports `ee/`, there is no module loader to rot, and the open
 * edition is simply the one nobody registered into.
 *
 * A feature is built at boot, once, out of what the server already has: its
 * database, the key secrets are encrypted under, and the session tools a route
 * that moves between organizations mints cookies with.
 */

import type { Router } from 'express';
import type { Db } from '@truecourse/db';
import type { WorkspaceSessionTools } from './auth/index.js';

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
  mount(context: ServerFeatureContext): ServerRouterMount[];
}

const features: ServerFeature[] = [];

export function registerServerFeature(feature: ServerFeature): void {
  features.push(feature);
}

export function registeredServerFeatures(): readonly ServerFeature[] {
  return features;
}

/** Test seam: a registration must not outlive the test that made it. */
export function clearServerFeatures(): void {
  features.length = 0;
}
