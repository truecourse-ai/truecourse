/**
 * The identities every store seam is keyed by, and how a working tree resolves
 * its own. The local flow derives the commit from the repo's `HEAD`; a hosted
 * run passes `repoKey`/`commitSha` explicitly (a shallow clone's `HEAD` is
 * unreliable after `checkout -f FETCH_HEAD`).
 */

import { DEFAULT_VERSION_SCOPE } from '@truecourse/shared';
import { getGit } from './git.js';

/**
 * The scope a series is read and written in when none is named: the default
 * branch's line of versions. A pull request's versions live under a scope of
 * their own, so the two never shadow each other.
 */
export const DEFAULT_SCOPE = DEFAULT_VERSION_SCOPE;

/**
 * Identity of one persisted set. `repoKey` is the opaque per-repository handle
 * — a stable repo id, e.g. the GitHub `owner/repo`. `commitSha` is the git SHA
 * the set was produced at — the run's commit; the store rejects an empty one.
 * `scope` names the series the set belongs to; the default branch's when absent.
 */
export interface RepoRef {
  repoKey: string;
  commitSha: string;
  scope?: string;
}

/**
 * Identity of a WORKSPACE-scoped set. A workspace's documentation is shared by
 * every repository in it, so it is keyed by the org rather than a repository:
 * `workspaceOrgId` is the WorkOS organization id (= `req.user.organizationId`,
 * the same value stored as `repositories.workspace_org_id`). `scope` names the
 * series as it does on a `RepoRef`.
 */
export interface WorkspaceRef {
  workspaceOrgId: string;
  scope?: string;
}

/**
 * Who produced a stored version: the session run it came out of and the model
 * that run was on. Both optional — a version written by hand, or by a path with
 * no run record, carries neither.
 */
export interface VersionProvenance {
  producedByRun?: string | null;
  model?: string | null;
}

/**
 * Where in a series a read lands. Nothing named: the newest version in the
 * default scope. `commitSha`: the newest at that commit. `id`: that one version,
 * whatever its scope or commit.
 */
export interface VersionAt {
  scope?: string;
  commitSha?: string;
  id?: string;
}

/**
 * HEAD sha, or `''` when `repoRoot` is not a git repo. Working-tree dirtiness is
 * intentionally NOT reflected in the key: two saves at the same HEAD collide by
 * design — the Postgres store upserts the manifest row and content-addressing
 * re-puts only changed objects.
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
