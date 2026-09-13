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
} from '@truecourse/core/lib/context-store';
import { repositorySourceId } from '@truecourse/core/services/context';
import { type ContextSource } from '@truecourse/shared';
import { emitContextChanged } from './context.service.js';

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
