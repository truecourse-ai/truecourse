/**
 * The identities every store seam is keyed by, and how a working tree resolves
 * its own. The local flow derives the commit from the repo's `HEAD`; a hosted
 * run passes `repoKey`/`commitSha` explicitly (it has the PR head SHA, and a
 * shallow clone's `HEAD` is unreliable after `checkout -f FETCH_HEAD`).
 */

import { getGit } from './git.js';

/**
 * Identity of one persisted set. `repoKey` is the opaque per-repo handle (a
 * filesystem path for the file impl; a stable repo id - e.g. the GitHub
 * `owner/repo` - for the hosted one). `commitSha` is the git SHA the set was
 * produced at: the gate = PR head; local = HEAD; a dirty tree falls back to
 * HEAD; `''` = a non-git workspace (the file impl ignores it, the Postgres impl
 * rejects it).
 */
export interface RepoRef {
  repoKey: string;
  commitSha: string;
}

/**
 * Identity of a WORKSPACE-scoped set. A workspace's documentation is shared by
 * every repository in it, and is **always-latest** - one current set per org per
 * artifact, with no commit dimension. `workspaceOrgId` is the WorkOS
 * organization id (= `req.user.organizationId`, the same value stored as
 * `gh_repos.workspace_org_id`).
 */
export interface WorkspaceRef {
  workspaceOrgId: string;
}

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
