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
 * EVENTS. A Context mutation is workspace-wide, not repository-scoped, so it
 * rides the SSE stream every workspace already holds open (`/api/events`)
 * rather than a repo socket room. Boot installs the publisher; with none
 * installed (a test app, a server whose queue never came up) emitting is a
 * silent no-op, exactly as a socket emit is.
 */

import type { ContextSourceKind, ServerEvent } from '@truecourse/shared';
import {
  contextDrivers,
  type ContextDriverDeps,
  type ContextSourceDriver,
} from '@truecourse/core/services/context';
import { log } from '@truecourse/core/lib/logger';
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
 * The driver deps this server runs on: repositories are cloned through the
 * work-tree seam, and every site fetch is refused a non-public destination —
 * this process must never be talked into reaching its own network.
 */
export function contextDriverDeps(): ContextDriverDeps {
  return (
    deps ?? {
      publicOnly: true,
      acquireTree: async (repoFullName) => acquireWorkTree(repoFullName),
    }
  );
}

/** The drivers, built from this server's deps. */
export function serverContextDrivers(): Map<ContextSourceKind, ContextSourceDriver> {
  return contextDrivers(contextDriverDeps());
}
