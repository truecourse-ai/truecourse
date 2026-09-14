/**
 * What this package is, in the provider vocabulary the repositories table
 * speaks. One constant rather than a literal at each call site, so a row this
 * package wrote is recognizable as the App's from anywhere.
 */

import type { RepositoryProviderId, RepositoryRecord } from '@truecourse/shared';

export const GITHUB_PROVIDER: RepositoryProviderId = 'github';

/**
 * The installation a connected repository reads through, or null when it did
 * not come through the App at all. Installation ids are numbers in GitHub's
 * API and text in the provider-generic row; this is where the two meet.
 */
export function installationOf(repo: RepositoryRecord): number | null {
  if (repo.provider !== GITHUB_PROVIDER || !repo.accountId) return null;
  const id = Number(repo.accountId);
  return Number.isInteger(id) ? id : null;
}
