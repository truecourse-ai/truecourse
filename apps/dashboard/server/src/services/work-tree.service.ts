/**
 * The one way a run gets a working tree. Repos are opaque identities
 * (`owner/repo`) with no persistent checkout, so anything that needs real
 * files — the spec scan today, guard runs later — acquires an ephemeral clone
 * through this seam and disposes it when the run settles.
 *
 * The GitHub connection installs the real provider at boot (installation
 * token + `createRunClone`); tests install a fixture-tree provider. With no
 * provider installed (GITHUB_APP_* unset) acquiring answers 503, mirroring
 * what /api/github itself tells an unconfigured server's callers.
 */

import { createAppError } from '@truecourse/core/lib/errors';
import type { RunClone } from './run-clone.service.js';

export type WorkTreeProvider = (repoKey: string) => Promise<RunClone>;

let provider: WorkTreeProvider | null = null;

export function setWorkTreeProvider(next: WorkTreeProvider | null): void {
  provider = next;
}

/** Clone `repoKey`'s default branch into a per-run tree. Caller disposes. */
export async function acquireWorkTree(repoKey: string): Promise<RunClone> {
  if (!provider) {
    throw createAppError('GitHub is not configured on this server, so repositories cannot be cloned for runs.', 503);
  }
  return provider(repoKey);
}
