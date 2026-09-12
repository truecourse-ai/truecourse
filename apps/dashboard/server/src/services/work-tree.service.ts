/**
 * The one way a run gets a working tree. Repos are opaque identities
 * (`owner/repo`) with no persistent checkout, so anything that needs real
 * files, such as a context source's sync or a guard run, acquires an ephemeral
 * clone through this seam and disposes it when the run settles.
 *
 * WHICH INSTALLATION mints the clone has two answers. A guard run asks by name
 * alone: the repository is connected in Code, and its link says which
 * installation and which branch. A context source may read a repository Code
 * has not connected, so it asks through `via`, which carries the installation
 * it recorded, its workspace and its branch, and no link is looked up at all.
 *
 * The GitHub connection installs the real provider at boot (installation
 * token + `createRunClone`); tests install a fixture-tree provider. With no
 * provider installed (GITHUB_APP_* unset) acquiring answers 503, mirroring
 * what /api/github itself tells an unconfigured server's callers.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import type { RunClone } from './run-clone.service.js';

/** The installation a caller already knows, so no link is read to find one. */
export interface WorkTreeVia {
  installationId: number;
  /** The workspace whose run-clones dir the checkout lands under. */
  workspaceOrgId: string;
  /** The branch to clone. Absent means the repository's default branch. */
  defaultBranch?: string;
}

export type WorkTreeProvider = (repoKey: string, via?: WorkTreeVia) => Promise<RunClone>;

let provider: WorkTreeProvider | null = null;

export function setWorkTreeProvider(next: WorkTreeProvider | null): void {
  provider = next;
}

/** Clone `repoKey` into a per-run tree, through `via` when one is given. Caller disposes. */
export async function acquireWorkTree(repoKey: string, via?: WorkTreeVia): Promise<RunClone> {
  if (!provider) {
    throw createAppError('GitHub is not configured on this server, so repositories cannot be cloned for runs.', 503);
  }
  return provider(repoKey, via);
}
