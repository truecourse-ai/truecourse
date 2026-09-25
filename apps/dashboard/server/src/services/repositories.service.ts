/**
 * The repositories a workspace may see, as every surface lists them: the home
 * page's registry route and the MCP tools read the same answer here.
 *
 * A registry row is visible only when the repository store ties it to the
 * workspace. No store means no connected repositories and an empty list, never
 * every workspace's rows.
 */

import { readRegistry, type RegistryEntry } from '@truecourse/core/config/registry';
import { resolveLatestEvent } from '@truecourse/core/commands/repo-events';
import type { RepoLinkStore } from '../routes/repos.js';

/**
 * The registry rows this workspace may see, in the order its registry holds
 * them, each with whether its pull requests are checked.
 */
export async function visibleRepositories(
  links: Pick<RepoLinkStore, 'listReposForWorkspace'> | null | undefined,
  org: string | null | undefined,
): Promise<Array<RegistryEntry & { checkPullRequests: boolean }>> {
  if (!links || !org) return [];
  const entries = await readRegistry(org);
  const mine = new Map(
    (await links.listReposForWorkspace(org)).map((r) => [r.repoFullName, r.checkPullRequests === true]),
  );
  return entries
    .filter((e) => mine.has(e.name))
    .map((e) => ({ ...e, checkPullRequests: mine.get(e.name) === true }));
}

/** One repository as the home page lists it. */
export interface RepositorySummary {
  id: string;
  name: string;
  path: string;
  provider: RegistryEntry['provider'];
  defaultBranch: string | null;
  checkPullRequests: boolean;
  latestEvent: Awaited<ReturnType<typeof resolveLatestEvent>>;
}

/**
 * The workspace's connected repositories, each with its most recent lifecycle
 * event (guard generate / guard run) composed from the per-repo stores' own
 * timestamps — tolerant of missing or unreadable state.
 */
export async function listRepositorySummaries(
  links: Pick<RepoLinkStore, 'listReposForWorkspace'> | null | undefined,
  org: string | null | undefined,
): Promise<RepositorySummary[]> {
  const entries = await visibleRepositories(links, org);
  return Promise.all(
    entries.map(async (e) => ({
      id: e.slug,
      name: e.name,
      path: e.path,
      provider: e.provider,
      defaultBranch: e.defaultBranch ?? null,
      checkPullRequests: e.checkPullRequests,
      latestEvent: await resolveLatestEvent(e.path),
    })),
  );
}
