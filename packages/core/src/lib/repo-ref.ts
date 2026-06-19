/**
 * Build a `RepoRef` (opaque repo handle + the git commit a contract/spec set
 * was produced at) for the contract/spec stores. The local/CLI flow derives the
 * commit from the repo's `HEAD`; the GitHub App passes `repoKey`/`commitSha`
 * explicitly (it has the PR head SHA, and the shallow clone's `HEAD` is
 * unreliable after `checkout -f FETCH_HEAD`).
 */

import { getGit } from './git.js';
import type { RepoRef } from './contract-store.js';

/**
 * HEAD sha, or `''` when `repoRoot` is not a git repo. Working-tree dirtiness is
 * intentionally NOT reflected in the key: two saves at the same HEAD collide by
 * design — the EE store upserts the manifest row and content-addressing re-puts
 * only changed objects.
 */
export async function resolveCommitSha(repoRoot: string): Promise<string> {
  try {
    const git = await getGit(repoRoot);
    return (await git.revparse(['HEAD'])).trim();
  } catch {
    return '';
  }
}

/** Build a `RepoRef` for `repoRoot`, deriving the commit from HEAD unless overridden. */
export async function repoRef(repoRoot: string, commitOverride?: string): Promise<RepoRef> {
  return {
    repoKey: repoRoot,
    commitSha: commitOverride ?? (await resolveCommitSha(repoRoot)),
  };
}
