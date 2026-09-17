/**
 * Connecting and disconnecting a repository, reported from the store that
 * writes it.
 *
 * A repository row is written down two paths — the App's connect route and a
 * folder connected in local mode — and taken away down four: the disconnect
 * route, the App uninstalled, a grant revoked (both webhooks, with no browser
 * anywhere), and the rollback of a connect whose onboarding could not start.
 * The store is the one thing common to all of them, so that is where the two
 * events are established. Nothing else has to remember to report.
 *
 * `@truecourse/github-app` and `@truecourse/data-store` know nothing about any
 * of this: the dashboard server hands them the wrapped store.
 */

import type { RepositoryRecord, RepositoryStore } from '@truecourse/shared';
import { currentActor } from '../middleware/actor.js';
import { captureAction, EVENTS } from './posthog.js';

/** How the write reached the store: a signed-in person, or GitHub on its own. */
type Via = 'app' | 'github';

/** Report one repository write as the person behind it, or as its workspace. */
function report(
  event: typeof EVENTS.repoConnected | typeof EVENTS.repoDisconnected,
  repo: Pick<RepositoryRecord, 'repoFullName' | 'provider' | 'workspaceOrgId'>,
): void {
  const actor = currentActor();
  const via: Via = actor ? 'app' : 'github';
  captureAction(event, {
    ...(actor ? { userId: actor.userId } : {}),
    workspaceId: repo.workspaceOrgId,
    properties: { repo: repo.repoFullName, provider: repo.provider, via },
  });
}

/**
 * The same store, reporting what it wrote. A disconnect reads the row first:
 * its workspace and provider are the facts of the event, and a name no row
 * answers to is nothing that happened.
 */
export function observeRepositories(store: RepositoryStore): RepositoryStore {
  return {
    linkRepo: async (rec) => {
      const stored = await store.linkRepo(rec);
      report(EVENTS.repoConnected, stored);
      return stored;
    },
    unlinkRepo: async (repoFullName) => {
      const going = await store.getRepo(repoFullName);
      await store.unlinkRepo(repoFullName);
      if (going) report(EVENTS.repoDisconnected, going);
    },
    getRepo: (repoFullName) => store.getRepo(repoFullName),
    listReposForWorkspace: (workspaceOrgId) => store.listReposForWorkspace(workspaceOrgId),
    listReposForAccount: (provider, accountId) => store.listReposForAccount(provider, accountId),
    // A move keeps every connection: nothing was connected or disconnected.
    moveReposToAccount: (provider, from, to) => store.moveReposToAccount(provider, from, to),
  };
}
