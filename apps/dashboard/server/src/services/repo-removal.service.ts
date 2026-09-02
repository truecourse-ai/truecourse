/**
 * Disconnecting a repository: stop its in-flight jobs, drop the server-side
 * per-repo run state, and purge the repo's rows from the database. Shared by
 * every way a repo leaves — `DELETE /api/repos/:id`, the GitHub unlink hook,
 * and the webhook's repo-removal path — so all of them make the same decision.
 *
 * There is no working copy to delete: connected repos have no persistent
 * clone (runs use ephemeral work trees that dispose themselves). The durable
 * artifacts live in Postgres keyed by the bare repo key with no workspace
 * column, so they MUST be purged here — left behind, they would be inherited
 * by the next workspace to connect the same `owner/repo`. What remains on
 * disk is the repo's session-transcript directory, keyed by identity under
 * the global dir — also removed here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createAppError } from '@truecourse/core/lib/errors';
import { sessionsDir } from '@truecourse/core/lib/sessions-store';

/**
 * How disconnect stops the repository's background jobs (its scan, its guard
 * setup). Installed at boot with the job runner; absent in file mode (tests and
 * a server whose queue never came up), where there are no jobs to stop.
 */
export type RepoJobsCanceller = (
  repoKey: string,
  orgId: string,
) => Promise<'stopped' | 'not-here'>;

let cancelRepoJobs: RepoJobsCanceller | null = null;

export function setRepoJobsCanceller(next: RepoJobsCanceller | null): void {
  cancelRepoJobs = next;
}

/**
 * Deletes every per-repo database row. Installed at boot alongside the
 * Postgres stores; absent in file mode (tests), where the registry entry IS
 * the state and there is nothing keyed by repo identity to purge.
 */
export type RepoDataPurge = (repoKey: string) => Promise<void>;

let purgeRepoData: RepoDataPurge | null = null;

export function setRepoDataPurge(next: RepoDataPurge | null): void {
  purgeRepoData = next;
}

export async function removeRepoRunState(repoKey: string, orgId: string): Promise<void> {
  // An in-flight job holds an ephemeral clone and is appending transcripts
  // right now. One running in THIS process is aborted and awaited
  // (disconnecting the repository is the answer to whether its work is still
  // wanted) and a queued one is settled cancelled, so the chain a scan would
  // have started never runs. Only a job claimed by another replica — which is
  // not ours to stop — refuses the disconnect.
  if ((await cancelRepoJobs?.(repoKey, orgId)) === 'not-here') {
    throw createAppError(
      'Another process is working on this repository. Wait for it to finish, then disconnect.',
      409,
    );
  }

  // The transcripts. Guarded to an absolute resolved path: with no resolver
  // installed (bare tests) an identity key resolves relative to cwd, and a
  // relative rm is nobody's intent.
  const dir = sessionsDir(repoKey);
  if (path.isAbsolute(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The database rows. A purge failure throws: the caller keeps the repo
  // connected (and the disconnect retryable) rather than deleting the link
  // row over data the next workspace would inherit.
  await purgeRepoData?.(repoKey);
}
