/**
 * Disconnecting a repository: stop its running scan and drop the server-side
 * per-repo run state. Shared by the two ways a repo leaves — `DELETE
 * /api/repos/:id` and the GitHub unlink hook — so both make the same decision.
 *
 * There is no working copy to delete: connected repos have no persistent
 * clone (runs use ephemeral work trees that dispose themselves), and every
 * durable artifact lives in Postgres, invisible once the link row is gone.
 * What remains on disk is the repo's session-transcript directory, keyed by
 * identity under the global dir — removed here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createAppError } from '@truecourse/core/lib/errors';
import { sessionsDir } from '@truecourse/core/lib/sessions-store';
import { cancelSpecScan, isSpecScanRunning, ownsSpecScan } from './onboarding-scan.service.js';

export async function removeRepoRunState(repoKey: string): Promise<void> {
  // A running spec scan holds an ephemeral clone and is appending transcripts
  // right now. A scan THIS process started is cancelled and awaited
  // (disconnecting the repository is the answer to whether it is still
  // wanted); only a scan we cannot stop refuses the disconnect.
  if (isSpecScanRunning(repoKey) && !(await cancelSpecScan(repoKey))) {
    throw createAppError(
      ownsSpecScan(repoKey)
        ? 'The spec scan for this repository did not stop in time. Try again in a moment.'
        : 'Another process is scanning this repository. Wait for it to finish, then disconnect.',
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
}
