/**
 * What a repository's own documentation IS to Context, and what disconnecting
 * it means.
 *
 * A repository's own documentation is a workspace source like any other, made
 * in Context. Connecting the repository in Code creates none: it only starts
 * the repository's setup, and the connect dialog links the sources that already
 * exist. What is left here is the lookup a push needs (which source reads this
 * repository) and the disconnect.
 *
 * Disconnect: the repository's links go and every source stays, because a
 * source belongs to the workspace and losing one reader is not losing it.
 */

import { log } from '@truecourse/core/lib/logger';
import {
  contextStoreInstalled,
  getContextSource,
  listContextSources,
  setContextBindings,
  updateContextSource,
} from '@truecourse/core/lib/context-store';
import { repositorySourceId } from '@truecourse/core/services/context';
import type { ContextSource, RepositorySourceConfig } from '@truecourse/shared';
import { emitContextChanged } from './context.service.js';

/** How a repository's Repository source is refreshed (on connect, and on a change). */
export type ContextSyncStart = (
  orgId: string,
  sourceId: string,
  source: 'add' | 'push',
) => Promise<'queued' | 'busy' | 'failed'>;

/**
 * Re-read a repository's own documentation because its default branch moved: a
 * push for a connected provider, a file changing on disk for a folder. A
 * repository with no source of its own has nothing to do here.
 *
 * Fire-and-forget by contract — whatever moved the repository has already
 * happened, and a sync that could not be enqueued is a log line, not a failure.
 */
export function syncRepositorySource(
  org: string,
  repoFullName: string,
  start: ContextSyncStart,
): void {
  void (async () => {
    try {
      const source = await repositoryContextSource(org, repoFullName);
      if (!source) return;
      const outcome = await start(org, source.id, 'push');
      if (outcome !== 'queued') {
        log.info(`[context] ${repoFullName} moved, context sync ${outcome}`);
      }
    } catch (err) {
      log.warn(
        `[context] could not sync ${repoFullName}'s context after a change: ${(err as Error).message}`,
      );
    }
  })();
}

/** The workspace's Repository source for this repository, or null. */
export async function repositoryContextSource(
  org: string,
  repoFullName: string,
): Promise<ContextSource | null> {
  if (!contextStoreInstalled()) return null;
  const byId = await getContextSource(org, repositorySourceId(repoFullName));
  if (byId && sourceScopes(byId, repoFullName)) return byId;
  // A source whose id was taken (a repository renamed into another's slug) is
  // still found by what it scopes — the config is the identity, not the id.
  const sources = await listContextSources(org);
  return sources.find((source) => sourceScopes(source, repoFullName)) ?? null;
}

function sourceScopes(source: ContextSource, repoFullName: string): boolean {
  return (
    source.kind === 'repository' &&
    (source.config as { repoFullName?: string }).repoFullName === repoFullName
  );
}

/**
 * Point every Repository source of the workspace that reads through one
 * GitHub installation at another: the App was reinstalled on the account and
 * GitHub gave it a new id. Answers how many moved.
 */
export async function rekeyRepositorySources(
  org: string,
  fromInstallationId: number,
  toInstallationId: number,
): Promise<number> {
  return rekeySources(org, toInstallationId, (config) => config.installationId === fromInstallationId);
}

/**
 * Point every Repository source of the workspace that reads a repository OWNED
 * by one GitHub account at the installation that account just attached under.
 * GitHub allows one installation of the App per account, so a source naming
 * any other installation for that owner is stale: the App was uninstalled
 * from the account and installed again, and the row that would have said so
 * went with the last workspace that removed it. Answers how many moved.
 */
export async function rekeyRepositorySourcesOfAccount(
  org: string,
  accountLogin: string,
  toInstallationId: number,
): Promise<number> {
  const owner = accountLogin.toLowerCase();
  if (!owner) return 0;
  return rekeySources(
    org,
    toInstallationId,
    (config) =>
      config.installationId !== toInstallationId &&
      (config.repoFullName ?? '').split('/')[0]?.toLowerCase() === owner,
  );
}

async function rekeySources(
  org: string,
  toInstallationId: number,
  stale: (config: Partial<RepositorySourceConfig>) => boolean,
): Promise<number> {
  if (!contextStoreInstalled()) return 0;
  let moved = 0;
  for (const source of await listContextSources(org)) {
    if (source.kind !== 'repository') continue;
    const config = source.config as Partial<RepositorySourceConfig>;
    if (config.provider === 'local' || !stale(config)) continue;
    await updateContextSource(org, source.id, {
      config: { ...config, installationId: toInstallationId } as RepositorySourceConfig,
    });
    moved += 1;
  }
  return moved;
}

/**
 * Drop the repository's links. Its sources are the workspace's and stay: a
 * disconnect in Code says nothing about what Context reads, and a source is
 * removed in Context. Best-effort by contract, a disconnect must not fail on
 * this.
 */
export async function removeRepositoryContext(
  org: string,
  repoFullName: string,
): Promise<void> {
  if (!contextStoreInstalled()) return;
  try {
    await setContextBindings(org, repoFullName, []);
    await emitContextChanged(org, { change: 'bindings', repoFullName });
  } catch (err) {
    log.warn(
      `[context] could not clear ${repoFullName}'s context on disconnect: ${(err as Error).message}`,
    );
  }
}
