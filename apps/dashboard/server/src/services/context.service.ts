/**
 * The server's half of Context: the driver deps every caller shares, and the
 * workspace-level event the pages listen to.
 *
 * DRIVERS. A source's driver needs two things this server owns — a checkout of
 * a connected repository (the run-clone provider the GitHub connection
 * installs) and the public-only network policy a hosted fetch must obey. Both
 * are built here so the preview route, the sync job and the connect hook drive
 * exactly the same drivers.
 *
 * An EDITION adds kinds of its own: boot hands this module the drivers its
 * features registered (`ServerFeature.contextDrivers`), each built for one
 * workspace at call time because a tool source reads the account THAT workspace
 * connected. They are merged over the open edition's two, so a route, the sync
 * job and the sweep all see one map and none of them knows which edition filled
 * it.
 *
 * A feature's kinds are the workspace's only while it holds the feature's
 * GRANT: an ungranted workspace is never offered them in Add context and has no
 * driver to sync them with, which is where the grant stops being decoration.
 *
 * EVENTS. A Context mutation is workspace-wide, not repository-scoped, so it
 * rides the SSE stream every workspace already holds open (`/api/events`)
 * rather than a repo socket room. Boot installs the publisher; with none
 * installed (a test app, a server whose queue never came up) emitting is a
 * silent no-op, exactly as a socket emit is.
 */

import {
  CONTEXT_SOURCE_KINDS,
  type ContextSourceKind,
  type EnterpriseFeature,
  type ServerEvent,
} from '@truecourse/shared';
import {
  contextDrivers,
  type ContextDriverDeps,
  type ContextSourceDriver,
} from '@truecourse/core/services/context';
import { log } from '@truecourse/core/lib/logger';
import type { FeatureContextDriver } from '../features.js';
import { workspaceEntitlements } from './entitlements.service.js';
import { acquireWorkTree } from './work-tree.service.js';

/** How a workspace-wide event reaches the workspace's open streams. */
export type ContextEventPublisher = (org: string, event: ServerEvent) => Promise<void> | void;

let publisher: ContextEventPublisher | null = null;

export function setContextEventPublisher(next: ContextEventPublisher | null): void {
  publisher = next;
}

/** What changed, and (when it was one) which source or repository it was. */
export interface ContextChange {
  change: 'sources' | 'documents' | 'bindings';
  sourceId?: string;
  repoFullName?: string;
}

/** Tell the workspace its Context moved. Best-effort: never fails the caller. */
export async function emitContextChanged(org: string, change: ContextChange): Promise<void> {
  if (!publisher) return;
  try {
    await publisher(org, { type: 'context.changed', ...change });
  } catch (err) {
    log.warn(`[context] could not publish the change event: ${(err as Error).message}`);
  }
}

let deps: ContextDriverDeps | null = null;

/** Substitute the driver deps (a test's fixture tree, a loopback fetch policy). */
export function setContextDriverDeps(next: ContextDriverDeps | null): void {
  deps = next;
}

/**
 * The driver deps this server runs on: repositories are read through the
 * work-tree seam, and every site fetch is refused a non-public destination —
 * this process must never be talked into reaching its own network.
 *
 * A repository source carries what it reads through: the installation a clone
 * is minted from, or the folder a copy is made of. Either way the tree lands
 * under this workspace, and the source can name a repository Code never
 * connected.
 */
export function contextDriverDeps(org: string): ContextDriverDeps {
  return (
    deps ?? {
      publicOnly: true,
      acquireTree: async (config) =>
        acquireWorkTree(config.repoFullName, {
          ...(config.provider ? { provider: config.provider } : {}),
          ...(config.installationId === undefined ? {} : { installationId: config.installationId }),
          ...(config.path ? { location: config.path } : {}),
          workspaceOrgId: org,
          ...(config.branch ? { defaultBranch: config.branch } : {}),
        }),
    }
  );
}

/** One feature's driver as the server installs it, with the grant it needs. */
export interface EditionContextDriver extends FeatureContextDriver {
  /** The grant a workspace must hold for this kind to be offered at all. */
  entitlement?: EnterpriseFeature;
}

let featureDrivers: readonly EditionContextDriver[] = [];

/** Install the drivers this edition's features registered. Boot calls it once. */
export function setFeatureContextDrivers(next: readonly EditionContextDriver[]): void {
  featureDrivers = next;
}

/**
 * The drivers, built from this server's deps for one workspace: the open
 * edition's two, and whichever of this edition's the workspace is entitled to.
 */
export async function serverContextDrivers(
  org: string,
): Promise<Map<ContextSourceKind, ContextSourceDriver>> {
  const drivers = contextDrivers(contextDriverDeps(org));
  if (featureDrivers.length === 0) return drivers;
  const held = new Set(await workspaceEntitlements(org));
  for (const feature of featureDrivers) {
    if (feature.entitlement && !held.has(feature.entitlement)) continue;
    drivers.set(feature.kind, feature.driver(org));
  }
  return drivers;
}

/**
 * The kinds this server can ADD for this workspace — the drivers it has for it,
 * in the vocabulary's own order, so the add dialog never offers a kind nothing
 * can sync and never offers one this workspace may not use.
 */
export async function addableContextKinds(org: string): Promise<ContextSourceKind[]> {
  const drivers = await serverContextDrivers(org);
  return CONTEXT_SOURCE_KINDS.filter((kind) => drivers.has(kind));
}
