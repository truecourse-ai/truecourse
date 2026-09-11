/**
 * What connecting and disconnecting a repository MEAN for Context.
 *
 * Connect: the repository gets its Repository source — the default patterns,
 * the branch the link records — linked to itself, and its first sync is
 * enqueued. That happens BEFORE the onboarding scan is enqueued, so the
 * workspace already knows the repository's documents exist by the time anything
 * reads them.
 *
 * Disconnect: the repository's links go, and its Repository source goes with
 * them — unless another repository still reads it (a platform repository's docs
 * feeding a service). A SITE the repository read is never removed: it belongs
 * to the workspace, and losing one reader is not losing the source.
 */

import { log } from '@truecourse/core/lib/logger';
import {
  contextBindings,
  contextReposForSource,
  contextStoreInstalled,
  createContextSource,
  getContextSource,
  listContextSources,
  removeContextSource,
  setContextBindings,
} from '@truecourse/core/lib/context-store';
import { repositoryConfig, repositorySourceId } from '@truecourse/core/services/context';
import {
  DEFAULT_REPOSITORY_EXCLUDE,
  DEFAULT_REPOSITORY_INCLUDE,
  type ContextSource,
} from '@truecourse/shared';
import { emitContextChanged } from './context.service.js';

export interface RepositoryContextInput {
  repoFullName: string;
  workspaceOrgId: string;
  /** The branch the source follows — the repository's default branch. */
  defaultBranch: string;
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
 * Make sure the repository has its source and reads it. Idempotent: a
 * repository that already has one keeps it (and its edited patterns) and is
 * only re-linked if the link went missing. Returns the source id, or null when
 * no workspace context store is installed (file mode).
 */
export async function ensureRepositoryContextSource(
  input: RepositoryContextInput,
): Promise<string | null> {
  if (!contextStoreInstalled()) return null;
  const { repoFullName, workspaceOrgId: org, defaultBranch } = input;
  const existing = await repositoryContextSource(org, repoFullName);
  const sourceId = existing?.id ?? repositorySourceId(repoFullName);
  if (!existing) {
    await createContextSource(org, {
      id: sourceId,
      kind: 'repository',
      title: repoFullName,
      config: repositoryConfig({
        repoFullName,
        include: [...DEFAULT_REPOSITORY_INCLUDE],
        exclude: [...DEFAULT_REPOSITORY_EXCLUDE],
        branch: defaultBranch,
      }),
    });
  }
  const links = await contextBindings(org, repoFullName);
  if (!links.includes(sourceId)) {
    await setContextBindings(org, repoFullName, [...links, sourceId]);
  }
  await emitContextChanged(org, { change: 'sources', sourceId });
  return sourceId;
}

/**
 * Drop the repository's links, and its own Repository source when nothing else
 * reads it. Best-effort by contract — a disconnect must not fail on this.
 */
export async function removeRepositoryContext(
  org: string,
  repoFullName: string,
): Promise<void> {
  if (!contextStoreInstalled()) return;
  try {
    const own = await repositoryContextSource(org, repoFullName);
    await setContextBindings(org, repoFullName, []);
    if (own) {
      const readers = await contextReposForSource(org, own.id);
      if (readers.length === 0) await removeContextSource(org, own.id);
    }
    await emitContextChanged(org, { change: 'sources', repoFullName });
  } catch (err) {
    log.warn(
      `[context] could not clear ${repoFullName}'s context on disconnect: ${(err as Error).message}`,
    );
  }
}
