/**
 * Disconnecting a repository: drop it from the registry and clean up its disk
 * footprint. Shared by the two ways a repo leaves — `DELETE /api/repos/:id` and
 * the GitHub unlink hook — so both make the same decision about what to delete.
 *
 * The repo's SOURCE is never touched, with one exception: a clone the dashboard
 * made is deleted whole, because the dashboard is the only thing that ever
 * wanted it. Both conditions are required — a `remoteUrl` alone (a hosted
 * registry could carry one for a repo we did not clone) never authorizes
 * deleting a directory.
 */

import fs from 'node:fs';
import { createAppError } from '@truecourse/core/lib/errors';
import { getRepoTruecourseDir } from '@truecourse/core/config/paths';
import { unregisterProject, type RegistryEntry } from '@truecourse/core/config/registry';
import { isManagedClonePath } from './repo-clone.service.js';
import { cancelSpecScan, isSpecScanRunning, ownsSpecScan } from './onboarding-scan.service.js';

export async function removeProject(entry: RegistryEntry): Promise<void> {
  // A running spec scan is writing into this tree right now. Deleting it under
  // the scan leaves an orphaned `.truecourse/` the scan's later writes
  // recreate, and — because the in-flight guard is keyed on the path — blocks a
  // reconnect of the same repo from ever getting its onboarding scan. So the
  // scan goes first: a scan THIS process started is cancelled and awaited
  // (disconnecting the repository is the answer to whether it is still
  // wanted), and only a scan we cannot stop refuses the disconnect.
  if (isSpecScanRunning(entry.path) && !(await cancelSpecScan(entry.path))) {
    throw createAppError(
      ownsSpecScan(entry.path)
        ? 'The spec scan for this repository did not stop in time. Try again in a moment.'
        : 'Another process is scanning this repository. Wait for it to finish, then disconnect.',
      409,
    );
  }

  if (entry.remoteUrl && isManagedClonePath(entry.path)) {
    fs.rmSync(entry.path, { recursive: true, force: true });
  } else {
    const tcDir = getRepoTruecourseDir(entry.path);
    if (fs.existsSync(tcDir)) {
      fs.rmSync(tcDir, { recursive: true, force: true });
    }
  }

  await unregisterProject(entry.slug);
}
