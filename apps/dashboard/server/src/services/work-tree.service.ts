/**
 * The one way a run gets a working tree. Repos are opaque identities
 * (`owner/repo`, `local/<folder>`) with no persistent checkout, so anything
 * that needs real files, such as a context source's sync or a guard run,
 * acquires an ephemeral tree through this seam and disposes it when the run
 * settles.
 *
 * WHICH PROVIDER makes that tree is the repository's own: the GitHub App clones
 * through an installation, the local provider copies a folder. The provider is
 * resolved from the connected repository, except where the caller already knows
 * it — a context source may read a repository Code has not connected, and it
 * carries what it recorded (the provider, its installation or its path) in
 * `via`, so no row is looked up at all.
 *
 * Each provider installs its own maker at boot; tests install a fixture one.
 * With none installed for the provider a repository needs, acquiring answers
 * 503 rather than inventing a tree.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import type { RepositoryProviderId } from '@truecourse/shared';
import type { RunClone } from './run-clone.service.js';

/** What the caller already knows, so no repository row is read to find it. */
export interface WorkTreeVia {
  /** The provider it reads through. Absent means the repository's own. */
  provider?: RepositoryProviderId;
  /** The GitHub App installation, for a repository read through one. */
  installationId?: number;
  /** The workspace whose run-clones dir the tree lands under. */
  workspaceOrgId: string;
  /** The branch to clone. Absent means the repository's default branch. */
  defaultBranch?: string;
  /**
   * The commit to check out, when the tree must be a particular one: the
   * chain's pinned commit, a pull request's head. Absent means the branch's
   * tip. A provider that copies a folder has no commits to choose from.
   */
  commitSha?: string;
  /** Where the provider finds it when the name is not enough: a folder's path. */
  location?: string;
}

export type WorkTreeProvider = (repoKey: string, via?: WorkTreeVia) => Promise<RunClone>;

/** How a repository key resolves to the provider that has its files. */
export type RepoProviderLookup = (repoKey: string) => Promise<RepositoryProviderId | null>;

/**
 * The provider a repository nobody connected is assumed to come through. Only
 * the GitHub App can reach a repository by name alone, which is what a context
 * source over an unconnected repository does.
 */
const UNCONNECTED_PROVIDER: RepositoryProviderId = 'github';

const providers = new Map<RepositoryProviderId, WorkTreeProvider>();
let lookup: RepoProviderLookup | null = null;

/** Install how one provider makes a work tree. `null` removes it. */
export function setWorkTreeProvider(
  provider: RepositoryProviderId,
  make: WorkTreeProvider | null,
): void {
  if (make) providers.set(provider, make);
  else providers.delete(provider);
}

/** Install how a repository key resolves to its provider (boot: the link store). */
export function setRepoProviderLookup(next: RepoProviderLookup | null): void {
  lookup = next;
}

/** Acquire `repoKey`'s files in a per-run tree, through `via` when one is given. Caller disposes. */
export async function acquireWorkTree(repoKey: string, via?: WorkTreeVia): Promise<RunClone> {
  const id = via?.provider ?? (await lookup?.(repoKey)) ?? UNCONNECTED_PROVIDER;
  const make = providers.get(id);
  if (!make) {
    throw createAppError(
      id === 'github'
        ? 'GitHub is not configured on this server, so repositories cannot be cloned for runs.'
        : `This server has no ${id} repository provider, so ${repoKey} cannot be read for a run.`,
      503,
    );
  }
  return make(repoKey, via);
}
